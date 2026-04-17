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
import { Instrumentation } from "./plugin/instrumentation";
import { PluginLoader } from "./plugin/plugin-loader";
import { Plugins } from "./plugin/plugins";
import {
    OriginationData,
    assert,
    chainIdPromise,
    isEmbedded,
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

/**
 * Supervisor — design notes for plugin lifecycle and WebAssembly memory
 *
 * The supervisor facilitates all communication between an app shell and its
 * plugin tree. It is loaded as an iframe at supervisor.<root> by every app
 * subdomain. Treat the rules below as load-bearing; violating them is what
 * caused the original "RangeError: WebAssembly.Memory(): could not allocate
 * memory" failures and motivated this file's current shape.
 *
 * Why call-scoped instantiation
 *   Each WebAssembly.Memory reserves ~10GB of *virtual address space* (VAS)
 *   on 64-bit V8 under the guard-page scheme, regardless of physical RAM
 *   touched. Each plugin component decomposes into multiple core modules,
 *   and the ones that own memory each export their own Memory. With dozens
 *   of plugins live, VAS exhaustion (not RAM exhaustion) is the failure
 *   mode.
 *
 *   On the original design, Plugin.ready instantiated the plugin and that
 *   instance was retained for the iframe's lifetime. A single app's
 *   dependency tree (~20 plugins) was usually under the per-process VAS
 *   budget, but the budget is unbounded across iframes and across
 *   navigations:
 *     - Each app subdomain hosts its own supervisor iframe; same URL, but
 *       *separate JS realms* with separate Plugins registries. Nothing
 *       dedups across iframes.
 *     - Cross-app workflows (e.g. Config calling into Accounts for login,
 *       then into Permissions for a grant) compose multiple supervisor
 *       iframes simultaneously, each with its full plugin set live.
 *     - Detached/bfcached documents do not release their Memory
 *       reservations until V8 actually GCs them, so even sequential
 *       app-to-app navigation accumulates VAS.
 *   The failure presents as random, but it is just whichever workflow
 *   happens to compose enough live supervisors at once.
 *
 *   The current design fixes this by separating *fetch + compile* (cheap;
 *   no Memory) from *instantiate* (allocates Memory). Plugin handles
 *   (compiledPlugin, a WebAssembly.Module) are retained for reuse across
 *   calls. Live instances are created in entry()/getJson()/preloadPlugins()
 *   just before the synchronous call chain runs and disposed in finally(),
 *   so the working set is bounded by *one entry's needs*, not by the
 *   cumulative history of the iframe.
 *
 * Rules for anyone touching this file
 *   - Do not move instantiation back into Plugin construction or onto
 *     Plugin.ready. Keep the fetch/compile vs. instantiate split.
 *   - Every entrypoint that instantiates plugins (entry, getJson,
 *     preloadPlugins) MUST dispose in a finally clause, even on the error
 *     path. Phase 0 of doPreload() leaves system-plugin instances live for
 *     its own internal supervisorCall()s; the entrypoint's finally is what
 *     releases them.
 *   - Treat the systemPlugins set as the "always-needed-during-preload"
 *     set, not the "always-live" set. Adding a plugin here costs Memory
 *     during every preload, on every entry.
 *   - The component-parser utility WASM (utils.ts::parser) is the only
 *     intentionally-retained allocation between entries.
 *   - Comments here assume the Memory model header in plugin/plugin.ts
 *     for VAS / dispose / pinned / retained terminology. Keep it that way
 *     instead of duplicating context.
 */
export class Supervisor implements AppInterface {
    private plugins: Plugins;

    private loader: PluginLoader;

    private context: CallContext | undefined;

    private inst: Instrumentation;

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

    private preload(plugins: QualifiedPluginId[], reason: string): Promise<void> {
        const myPreload = this.preloadLock
            .catch(() => {})
            .then(() => this.doPreload(plugins, reason));
        this.preloadLock = myPreload.catch(() => {});
        return myPreload;
    }

    private async doPreload(plugins: QualifiedPluginId[], reason: string) {
        await chainIdPromise;

        if (plugins.length === 0) {
            return;
        }

        const reportT0 = this.inst.preloadReportStart();

        // Phase 0: compile + instantiate system plugins so the internal
        // sync calls below have live instances. Not pinned — the caller
        // disposes them in its finally clause.
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

        // Phase 1: compile app plugins (no instantiation — Memory deferred).
        this.loader.trackPlugins([...plugins]);
        await this.loader.processPlugins();
        await this.loader.awaitReady();

        // Phase 2: load auth-service plugins for connected accounts. This
        // sync call uses accounts:plugin, instantiated in Phase 0.
        const auth_services: string[] = this.supervisorCall(
            getCallArgs("accounts", "plugin", "admin", "getAuthServices", []),
        );

        const addtl_plugins: QualifiedPluginId[] = [];
        for (const service of auth_services) {
            if (!service) continue;
            // Limitation: an auth service plugin must be called "plugin".
            addtl_plugins.push(pluginId(service, "plugin"));
        }
        this.loader.trackPlugins(addtl_plugins);

        await this.loader.processPlugins();
        await this.loader.awaitReady();

        this.inst.preloadReportEnd(reportT0, reason);
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
        this.plugins = new Plugins(this);
        this.inst = new Instrumentation(this.plugins);
        this.parser = parser((c, m) => this.inst.onParserLoaded(c, m));
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
        this.inst.onCall(service, plugin);
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
        this.inst.onCall(service, plugin);
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

    // Returns the JSON interface for a plugin.
    async getJson(callerOrigin: string, id: string, plugin: QualifiedPluginId) {
        try {
            this.setParentOrigination(callerOrigin);
            await this.preload([plugin], `getJson:${plugin.service}:${plugin.plugin}`);
            const json = this.plugins.getPlugin(plugin).plugin.getJson();
            this.replyToParent(id, json);
        } catch (e) {
            this.replyToParent(id, e);
        } finally {
            // Release Phase-0 system plugin instances left live by preload.
            this.plugins.disposeAllUnpinned();
        }
    }

    // Entrypoint for apps to preload plugins on pageload, decoupling
    // download/parse/compile from the eventual call.
    async preloadPlugins(callerOrigin: string, plugins: QualifiedPluginId[]) {
        try {
            this.setParentOrigination(callerOrigin);
            const reason = `preloadPlugins:[${plugins
                .map((p) => `${p.service}:${p.plugin}`)
                .join(",")}]`;
            await this.preload(plugins, reason);
        } catch (e) {
            console.error("TODO: Return an error to the caller.");
            console.error(e);
        } finally {
            this.plugins.disposeAllUnpinned();
        }
    }

    /** Tear down every instantiated plugin before the supervisor iframe
     *  is evicted. compiledPlugin handles are retained for bfcache restore.
     *  Idempotent. */
    shutdown(): string[] {
        return this.plugins.disposeAll();
    }

    // Entrypoint for apps to call into plugins.
    async entry(
        callerOrigin: string,
        id: string,
        args: QualifiedFunctionCallArgs,
    ): Promise<any> {
        const entryLabel = `${args.service}:${args.plugin} ${
            args.intf ? `${args.intf}.` : ""
        }${args.method}`;
        const handle = this.inst.entryStart(entryLabel);
        let entryError: unknown = undefined;
        let disposed: string[] = [];

        try {
            this.setParentOrigination(callerOrigin);

            // Load the full plugin tree (download + parse + transpile + compile).
            // System plugins are instantiated as a side effect for preload's
            // internal sync calls; they're disposed in finally with the rest.
            const preT0 = this.inst.entryPreloadStart();
            try {
                await this.preload(
                    [
                        {
                            service: args.service,
                            plugin: args.plugin,
                        },
                    ],
                    `entry:${entryLabel}`,
                );
            } finally {
                this.inst.entryPreloadEnd(preT0);
            }

            // Instantiate everything else so the synchronous call chain
            // has live instances. Phase 0 plugins are no-ops here.
            const instT0 = this.inst.entryInstStart();
            try {
                await this.plugins.ensureAllInstantiated();
            } finally {
                this.inst.entryInstEnd(instT0);
            }

            this.context = this.getCallContext();

            this.supervisorCall(
                getCallArgs("transact", "plugin", "admin", "startTx", []),
            );

            // Synchronous — everything was preloaded.
            const result = this.call(args);

            // Closes the tx context. If actions were added, tx is submitted.
            const txResult = this.supervisorCall(
                getCallArgs("transact", "plugin", "admin", "finishTx", []),
            );
            if (txResult !== null && txResult !== undefined) {
                console.warn(txResult);
            }

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
            // Sweep all non-pinned instances. Catches partial-instantiation
            // failures (system plugins that came up before a Phase-0 error)
            // so no half-pinned state persists between calls.
            disposed = this.plugins.disposeAllUnpinned();
            this.inst.entryEnd(handle, disposed, entryError);
        }
    }
}
