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
import { InstancePool } from "./plugin/instance-pool";
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

// The supervisor facilitates all communication
export class Supervisor implements AppInterface {
    private plugins: Plugins;

    private loader: PluginLoader;

    private pool: InstancePool;

    private context: CallContext | undefined;

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

        // Phase 0: Compile and instantiate system plugins (needed for sync
        // calls between phases — getActivePrompt, getActiveQueryToken, etc.)
        this.loader.trackPlugins([...systemPlugins]);
        await this.loader.processPlugins();
        await this.loader.awaitReady();
        await this.loader.ensureAllInstantiated();

        // Pin all Phase 0 plugins — they are never evicted
        this.plugins.forEachPlugin(p => {
            if (p.isInstantiated) this.pool.register(p, true);
        });
        console.log(`[pool] system plugins pinned — ${this.pool.summary()}`);

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

        // Instantiate all remaining plugins (Phase 1 + Phase 2) before entry()
        // starts its synchronous call chain.
        await this.plugins.ensureAllInstantiated();

        // Register newly instantiated plugins with the pool (not pinned)
        this.plugins.forEachPlugin(p => {
            if (p.isInstantiated) this.pool.register(p);
        });
        console.log(`[pool] preload complete — ${this.pool.summary()}`);
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

        this.pool = new InstancePool();
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
        const p = this.plugins.getAssertPlugin({ service, plugin });
        this.pool.touch(p);

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
        const p = this.plugins.getAssertPlugin({ service, plugin });
        this.pool.touch(p);

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
        }
    }

    // This is an entrypoint for apps to call into plugins.
    async entry(
        callerOrigin: string,
        id: string,
        args: QualifiedFunctionCallArgs,
    ): Promise<any> {
        try {
            this.setParentOrigination(callerOrigin);

            // Wait to load the full plugin tree (a plugin and all its dependencies, recursively).
            // This includes: downloading, parsing, building import proxies, transpiling the
            //   component via jco, compiling core WASM modules, and instantiating them.
            // System plugins are instantiated first (Phase 0); app and auth plugins are compiled
            //   in parallel, then instantiated before the synchronous call chain begins.
            // UIs should use `preloadPlugins` to decouple this task from the actual call to the plugin.
            await this.preload([
                {
                    service: args.service,
                    plugin: args.plugin,
                },
            ]);

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
            const evicted = this.pool.evictIdle();
            if (evicted > 0) {
                console.log(`[pool] post-entry eviction — ${this.pool.summary()}`);
            }
        }
    }
}
