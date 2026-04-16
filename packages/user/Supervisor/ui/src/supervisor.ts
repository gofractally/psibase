import {
    QualifiedFunctionCallArgs,
    QualifiedPluginId,
    assertTruthy,
    buildFunctionCallResponse,
    siblingUrl,
} from "@psibase/common-lib";
import {
    PluginErrorObject,
    QualifiedDynCallArgs,
    QualifiedResourceCallArgs,
    RedirectErrorObject,
    getResourceCallArgs,
} from "@psibase/common-lib/messaging";
import {
    getCallArgs,
    toString,
} from "@psibase/common-lib/messaging/function-call-request";
import { pluginId } from "@psibase/common-lib/messaging/plugin-id";

import { AppInterface } from "./app-interface";
import { CallContext } from "./call-context";
import { REDIRECT_ERROR_CODE } from "./constants";
import { getRecoverableError } from "./plugin/errors";
import { PluginLoader } from "./plugin/plugin-loader";
import { Plugins } from "./plugin/plugins";
import {
    OriginationData,
    assert,
    chainIdPromise,
    isEmbedded,
    getParserCoreCount,
    getParserMemoryCount,
    parser,
    serviceFromOrigin,
    setQueryToken,
} from "./utils";

const rootDomain = siblingUrl(null, null, null, true);

// System plugins are always loaded, even if they are not used
//   in a given call context.
const systemPlugins: Array<QualifiedPluginId> = [
    pluginId("accounts", "plugin"),
    pluginId("host", "auth"),
    pluginId("host", "prompt"),
    pluginId("transact", "plugin"),
    pluginId("clientdata", "plugin"),
    pluginId("webcrypto", "plugin"),
];

// Stats accumulated during a single entry() invocation for the post-call
// report. Populated by call()/callResource() while non-undefined; ignored
// when undefined (e.g. getJson path, or between entries).
interface EntryStats {
    callCount: number;
    perPlugin: Map<string, number>;
}

// The supervisor facilitates all communication
export class Supervisor implements AppInterface {
    private plugins: Plugins;

    private loader: PluginLoader;

    private context: CallContext | undefined;

    private entryStats: EntryStats | undefined;

    private embedder: string | undefined;

    parser: Promise<any>;

    parentOrigination: OriginationData | undefined;

    private getCallContext(): CallContext {
        assertTruthy(this.parentOrigination, "Parent origination corrupted");
        assertTruthy(this.parentOrigination.app, "Root app unrecognized");

        if (!this.context) {
            this.context = new CallContext(
                this.embedder,
                this.parentOrigination.app,
            );
        }
        return this.context;
    }

    private setParentOrigination(callerOrigin: string) {
        assert(
            this.parentOrigination === undefined ||
                this.parentOrigination.origin === callerOrigin,
            "Redundant setting parent origination",
        );

        if (callerOrigin === rootDomain) {
            this.parentOrigination = {
                app: "homepage",
                origin: callerOrigin,
            };
        } else {
            this.parentOrigination = {
                app: serviceFromOrigin(callerOrigin),
                origin: callerOrigin,
            };
        }
    }

    private preloadLock: Promise<void> = Promise.resolve();

    private preload(plugins: QualifiedPluginId[]): Promise<void> {
        const myPreload = this.preloadLock
            .catch(() => {})
            .then(() => this.doPreload(plugins));
        this.preloadLock = myPreload.catch(() => {});
        return myPreload;
    }

    private async doPreload(plugins: QualifiedPluginId[]) {
        await chainIdPromise;

        if (plugins.length === 0) {
            return;
        }

        const preT0 = performance.now();

        // Phase 0: Compile system plugins and instantiate them so the
        // internal sync calls below (getActivePrompt, getActiveQueryToken,
        // getAuthServices) have live instances to hit. These instances are
        // NOT pinned — the caller (entry / preloadPlugins / getJson) is
        // responsible for disposing them after whatever follow-up work
        // requires them. See the class-level flow comment on Supervisor.
        this.loader.trackPlugins([...systemPlugins]);
        await this.loader.processPlugins();
        await this.loader.awaitReady();
        await this.loader.ensureAllInstantiated();

        if (isEmbedded) {
            const promptDetails = await this.supervisorCall(
                getCallArgs("host", "prompt", "admin", "getActivePrompt", []),
            );
            if (promptDetails) {
                this.embedder = promptDetails.activeApp;
                delete this.context; // A new one will be created with the embedder
            }
        }

        setQueryToken(this.getActiveQueryToken());

        // Phase 1: Compile app plugins (NO instantiation yet — Memory deferred).
        // The sync call to getAuthServices below only touches Phase 0 plugins.
        this.loader.trackPlugins([...plugins]);
        await this.loader.processPlugins();
        await this.loader.awaitReady();

        // Phase 2: Load the auth services for all connected accounts.
        // This sync call uses accounts:plugin (Phase 0, already instantiated).
        const auth_services: string[] = this.supervisorCall(
            getCallArgs("accounts", "plugin", "admin", "getAuthServices", []),
        );

        const addtl_plugins: QualifiedPluginId[] = [];
        for (const service of auth_services) {
            if (!service) continue;

            // Current limitation: an auth service plugin must be called "plugin" ("<service>:plugin")
            addtl_plugins.push(pluginId(service, "plugin"));
        }
        this.loader.trackPlugins(addtl_plugins);

        await this.loader.processPlugins();
        await this.loader.awaitReady();

        // Phase 1 + Phase 2 plugins are COMPILED only. Phase 0 plugins are
        // still live at this point (instantiated above for the internal
        // sync calls). The caller will dispose them together with the rest
        // once its own work finishes.

        this.emitPreloadReport(performance.now() - preT0);
    }

    private emitPreloadReport(wallMs: number): void {
        const { fetched, compiled } = this.plugins.collectPreloadStats();
        if (fetched.length === 0 && compiled.length === 0) {
            return; // nothing new to report
        }

        const fmtKB = (b: number) => `${(b / 1024).toFixed(1)}KB`;
        const fmtMB = (b: number) => `${(b / 1024 / 1024).toFixed(2)}MB`;

        const totalBytes = fetched.reduce((s, f) => s + f.bytes, 0);
        const fetchSumMs = fetched.reduce((s, f) => s + f.ms, 0);
        const compileSumMs = compiled.reduce((s, c) => s + c.ms, 0);

        const lines = [
            `[preload] wall=${wallMs.toFixed(1)}ms ` +
                `fetched=${fetched.length}(${fmtMB(totalBytes)}, Σ${fetchSumMs.toFixed(1)}ms) ` +
                `compiled=${compiled.length}(Σ${compileSumMs.toFixed(1)}ms)`,
        ];
        if (fetched.length > 0) {
            lines.push(
                `    fetched: [${fetched
                    .map((f) => `${f.label}(${f.ms.toFixed(0)}ms, ${fmtKB(f.bytes)})`)
                    .join(", ")}]`,
            );
        }
        if (compiled.length > 0) {
            lines.push(
                `    compiled: [${compiled
                    .map((c) => `${c.label}(${c.ms.toFixed(0)}ms)`)
                    .join(", ")}]`,
            );
        }
        console.log(lines.join("\n"));
    }

    private replyToParent(id: string, result: any) {
        assertTruthy(this.parentOrigination, "Unknown reply target");
        window.parent.postMessage(
            buildFunctionCallResponse(id, result),
            this.parentOrigination.origin,
        );
    }

    private supervisorCall(callArgs: QualifiedFunctionCallArgs): any {
        const context = this.getCallContext();
        context.stack.push("supervisor", "callFunction");

        let ret: any;
        try {
            ret = this.call(callArgs);
        } finally {
            context.stack.pop();
        }

        return ret;
    }

    private supervisorResourceCall(callArgs: QualifiedResourceCallArgs): any {
        const context = this.getCallContext();
        context.stack.push("supervisor", "callResource");
        let ret: any;
        try {
            ret = this.callResource(callArgs);
        } finally {
            context.stack.pop();
        }

        return ret;
    }

    private getActiveQueryToken(): string | undefined {
        assertTruthy(this.parentOrigination, "Parent origination corrupted");
        assertTruthy(this.parentOrigination.app, "Root app unrecognized");

        const user = this.supervisorCall(
            getCallArgs("accounts", "plugin", "api", "getCurrentUser", []),
        );

        if (!user) {
            return undefined;
        }

        const token = this.supervisorCall(
            getCallArgs("host", "auth", "api", "getActiveQueryToken", [
                this.parentOrigination.app,
                user,
            ]),
        );
        return token;
    }

    constructor() {
        this.parser = parser();

        this.plugins = new Plugins(this);

        this.loader = new PluginLoader(this.plugins);
    }

    getRootDomain(): string {
        return rootDomain;
    }

    getServiceStack(): string[] {
        assertTruthy(this.context, "Uninitialized call context");
        return this.context.stack.export();
    }

    importKey(privateKey: string): string {
        // future: call out to SubtleCrypto
        // future: store privateKey, indexed by pubKey
        return this.supervisorCall(
            getCallArgs("webcrypto", "plugin", "api", "importKey", [
                privateKey,
            ]),
        );
    }

    signExplicit(msg: Uint8Array, privateKey: string): Uint8Array {
        // future: call out to SubtleCrypto
        return this.supervisorCall(
            getCallArgs("webcrypto", "plugin", "api", "signExplicit", [
                msg,
                privateKey,
            ]),
        );
    }

    sign(msg: Uint8Array, publicKey: string): Uint8Array {
        // future: call out to SubtleCrypto
        return this.supervisorCall(
            getCallArgs("webcrypto", "plugin", "api", "sign", [msg, publicKey]),
        );
    }

    call(args: QualifiedFunctionCallArgs): any {
        assertTruthy(this.context, "Uninitialized call context");

        const { service, plugin, intf, method, params } = args;
        if (this.entryStats) {
            this.entryStats.callCount++;
            const key = `${service}:${plugin}`;
            this.entryStats.perPlugin.set(
                key,
                (this.entryStats.perPlugin.get(key) ?? 0) + 1,
            );
        }
        const p = this.plugins.getAssertPlugin({ service, plugin });

        this.context.stack.push(args.service, toString(args));
        let ret: any;
        try {
            ret = p.call(intf, method, params);
        } finally {
            this.context.stack.pop();
        }

        return ret;
    }

    callDyn(args: QualifiedDynCallArgs): any {
        const service = this.supervisorResourceCall(
            getResourceCallArgs(
                "host",
                "types",
                "api",
                "PluginRef",
                args.handle,
                "getService",
                [],
            ),
        );
        const plugin = this.supervisorResourceCall(
            getResourceCallArgs(
                "host",
                "types",
                "api",
                "PluginRef",
                args.handle,
                "getPlugin",
                [],
            ),
        );
        const intf = this.supervisorResourceCall(
            getResourceCallArgs(
                "host",
                "types",
                "api",
                "PluginRef",
                args.handle,
                "getIntf",
                [],
            ),
        );

        return this.call(
            getCallArgs(service, plugin, intf, args.method, args.params),
        );
    }

    callResource(args: QualifiedResourceCallArgs): any {
        assertTruthy(this.context, "Uninitialized call context");
        const { service, plugin, intf, type, handle, method, params } = args;
        if (this.entryStats) {
            this.entryStats.callCount++;
            const key = `${service}:${plugin}`;
            this.entryStats.perPlugin.set(
                key,
                (this.entryStats.perPlugin.get(key) ?? 0) + 1,
            );
        }
        const p = this.plugins.getAssertPlugin({ service, plugin });

        this.context.stack.push(service, toString(args));
        let ret: any;
        try {
            ret = p.resourceCall(intf, type, handle, method, params);
        } finally {
            this.context.stack.pop();
        }

        return ret;
    }

    // This is an entrypoint that returns the JSON interface for a plugin.
    async getJson(callerOrigin: string, id: string, plugin: QualifiedPluginId) {
        try {
            this.setParentOrigination(callerOrigin);
            await this.preload([plugin]);
            const json = this.plugins.getPlugin(plugin).plugin.getJson();
            this.replyToParent(id, json);
        } catch (e) {
            this.replyToParent(id, e);
        } finally {
            // Release the Phase-0 system plugin instances that doPreload
            // left live for its internal sync calls. With nothing pinned
            // under the current policy, this sweeps every instantiated
            // plugin.
            this.plugins.disposeAllUnpinned();
        }
    }

    // This is an entrypoint for apps to preload plugins.
    // Intended to be used on pageload to prepare the plugins that an app requires,
    //   which accelerates the responsiveness of the plugins for subsequent calls.
    async preloadPlugins(callerOrigin: string, plugins: QualifiedPluginId[]) {
        try {
            this.setParentOrigination(callerOrigin);
            await this.preload(plugins);
        } catch (e) {
            console.error("TODO: Return an error to the caller.");
            console.error(e);
        } finally {
            // See getJson() — preload leaves system plugins instantiated
            // for its internal sync calls; we release them here so the
            // idle footprint between preloadPlugins() and the next
            // entry() stays at zero non-parser memories.
            this.plugins.disposeAllUnpinned();
        }
    }

    /**
     * Tear down every instantiated plugin before the supervisor iframe is
     * evicted or destroyed. Dropping `pluginModule` references here lets
     * V8 reclaim the backing WebAssembly.Memory allocations (and their
     * ~10GB of VAS reservation each) promptly on the next GC, regardless
     * of whether the iframe ends up in bfcache or is fully torn down.
     *
     * Retains `compiledPlugin` handles (WebAssembly.Module objects carry
     * no VAS), so bfcache restore can re-instantiate without re-fetching
     * or re-compiling.
     *
     * Safe to call multiple times; idempotent.
     */
    shutdown(): string[] {
        return this.plugins.disposeAll();
    }

    // This is an entrypoint for apps to call into plugins.
    async entry(
        callerOrigin: string,
        id: string,
        args: QualifiedFunctionCallArgs,
    ): Promise<any> {
        const entryLabel = `${args.service}:${args.plugin} ${args.intf ?? ""}.${args.method}`;
        const t0 = performance.now();
        let preloadMs = 0;
        let instMs = 0;
        let instantiatedThisCall: string[] = [];
        let disposed: string[] = [];
        let entryError: unknown = undefined;
        // Keep stats in a local so a concurrent entry() cannot wipe them
        // out. `this.entryStats` is only the pointer that call() /
        // callResource() use to locate "the currently-active entry's
        // stats". If a second entry() starts and overwrites the pointer,
        // late call() hits from the first entry will be misattributed to
        // the newer entry — but neither entry will crash in finally().
        const stats: EntryStats = { callCount: 0, perPlugin: new Map() };
        this.entryStats = stats;

        // Snapshot before preload so everything instantiated during this
        // entry (including Phase 0 system plugins brought live by preload
        // for its internal sync calls) is attributed to this entry in the
        // report. Matches the `disposed` set we capture in finally.
        const preInst = new Set(this.plugins.listInstantiated());

        try {
            this.setParentOrigination(callerOrigin);

            // Load the full plugin tree (downloading + parsing + transpiling
            //   via jco + compiling core WASM modules). Phase 0 system
            //   plugins are instantiated as a side-effect so the internal
            //   sync calls inside preload have live instances; they are
            //   NOT pinned, so the finally clause below will dispose them
            //   alongside everything we instantiate ourselves.
            // UIs should use `preloadPlugins` to decouple this task from the actual call to the plugin.
            const preT0 = performance.now();
            try {
                await this.preload([
                    {
                        service: args.service,
                        plugin: args.plugin,
                    },
                ]);
            } finally {
                preloadMs = performance.now() - preT0;
            }

            // Instantiate every remaining plugin (Phase 1 + Phase 2) so the
            // synchronous call chain below has live instances to call into.
            // Phase 0 plugins are already instantiated (no-op for them).
            // On a partial failure (e.g. OOM while instantiating one of
            // several peers), the finally clause still captures whatever
            // completed before the throw so the report is accurate.
            const instT0 = performance.now();
            try {
                await this.plugins.ensureAllInstantiated();
            } finally {
                instMs = performance.now() - instT0;
                instantiatedThisCall = this.plugins
                    .listInstantiated()
                    .filter((name) => !preInst.has(name));
            }

            this.context = this.getCallContext();

            // Starts the tx context.
            this.supervisorCall(
                getCallArgs("transact", "plugin", "admin", "startTx", []),
            );

            // Make a *synchronous* call into the plugin. It can be fully synchronous since everything was
            //   preloaded.
            const result = this.call(args);

            // Closes the current tx context. If actions were added, tx is submitted.
            const txResult = this.supervisorCall(
                getCallArgs("transact", "plugin", "admin", "finishTx", []),
            );
            if (txResult !== null && txResult !== undefined) {
                console.warn(txResult);
            }

            // Send plugin result to parent window
            this.replyToParent(id, result);

            this.context = undefined;
        } catch (e) {
            entryError = e;
            const err = getRecoverableError(e);
            if (err) {
                let newError;
                if (err.code === REDIRECT_ERROR_CODE) {
                    newError = new RedirectErrorObject(
                        err.producer,
                        err.message,
                    );
                } else {
                    newError = new PluginErrorObject(err.producer, err.message);
                }
                this.replyToParent(id, newError);
            } else {
                this.replyToParent(id, e);
            }

            this.context = undefined;
        } finally {
            // Dispose every non-pinned instance so V8 can reclaim the
            // backing WebAssembly.Memory (and its ~10GB of virtual address
            // space) on the next GC. Pinned system plugins stay live.
            // On a Phase 0 preload failure, system plugins that
            // instantiated before the error remain instantiated-but-
            // unpinned — so they also get caught by this sweep, which is
            // what we want (no half-pinned state persists between calls).
            disposed = this.plugins.disposeAllUnpinned();

            // Only clear the shared pointer if it still refers to OUR
            // stats object; otherwise a concurrent entry() owns it now.
            if (this.entryStats === stats) {
                this.entryStats = undefined;
            }
            const totalMs = performance.now() - t0;

            // Characterize cores/memories created during this entry.
            // Under the current no-pinning policy the instantiated set
            // should equal the disposed set (minus any teardown asymmetry
            // from partial failures mid-instantiation).
            const instCounts = this.plugins.countByLabels(instantiatedThisCall);
            const disposedCounts = this.plugins.countByLabels(disposed);

            // After dispose, the only persistent WASM allocation is the
            // component-parser utility module loaded once at supervisor
            // startup. Any instantiated plugins still alive here would
            // indicate a leak (e.g. plugin.pinned set by future work).
            const retained = this.plugins.countInstantiated();
            const retainedPlugins = retained.plugins + 1;
            const retainedCores = retained.cores + getParserCoreCount();
            const retainedMemories = retained.memories + getParserMemoryCount();

            const header =
                `[entry] ${entryLabel}` +
                (entryError !== undefined ? " FAILED" : "") +
                ` — total=${totalMs.toFixed(1)}ms ` +
                `preload=${preloadMs.toFixed(1)}ms ` +
                `inst=${instMs.toFixed(1)}ms ` +
                `calls=${stats.callCount} across ${stats.perPlugin.size} plugin(s)`;

            const lines: string[] = [header];
            if (entryError !== undefined) {
                const msg =
                    entryError instanceof Error
                        ? entryError.message
                        : String(entryError);
                lines.push(`    error: ${msg}`);
            }
            lines.push(
                instantiatedThisCall.length > 0
                    ? `    instantiated (${instantiatedThisCall.length}p / ${instCounts.cores}c / ${instCounts.memories}m): [${instantiatedThisCall.join(", ")}]`
                    : `    instantiated: (none)`,
                disposed.length > 0
                    ? `    disposed (${disposed.length}p / ${disposedCounts.cores}c / ${disposedCounts.memories}m): [${disposed.join(", ")}]`
                    : `    disposed: (none)`,
                `    retained: ${retainedPlugins}p / ${retainedCores}c / ${retainedMemories}m (parser)`,
            );

            console.log(lines.join("\n"));
        }
    }
}
