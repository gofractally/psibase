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

    // This step loads the full plugin tree (downloading + parsing + JCO transpiling)
    //
    // This does not instantiate wasms, with the exception of core system plugin wasms,
    //   which are instantiated as they are required to be executed during the preloading
    //   of all other plugins.
    //
    // The caller should dispose of all instantiated plugins after the entry function
    //  finishes.
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

        // Phase 0: Loads systemPlugins, including those needed to get current user, i.e., accounts, host:auth
        this.loader.trackPlugins([...systemPlugins]);
        await this.loader.processPlugins();
        await this.loader.awaitReady();

        // Required to instantiate system plugins to execute the plugin calls below
        await this.plugins.instantiateAll();

        if (isEmbedded) {
            const promptDetails = await this.supervisorCall(
                getCallArgs("host", "prompt", "admin", "get-active-prompt", []),
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
            getCallArgs("accounts", "plugin", "admin", "get-auth-services", []),
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
            getCallArgs("accounts", "plugin", "api", "get-current-user", []),
        );

        if (!user) {
            return undefined;
        }

        const token = this.supervisorCall(
            getCallArgs("host", "auth", "api", "get-active-query-token", [
                this.parentOrigination.app,
                user,
            ]),
        );
        return token;
    }

    // Cleanly tear down the supervisor, free any resources, etc.
    private shutdown(): string[] {
        return this.plugins.disposeAll();
    }

    constructor() {
        this.plugins = new Plugins(this);
        this.parser = parser();
        this.loader = new PluginLoader(this.plugins);

        // Without this, in some browsers (e.g. chromium), stale supervisor iframes persist
        //  after navigation events. This ensures that after navigations, dev tools look
        //  clean.
        window.addEventListener("pagehide", () => this.shutdown());
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
            getCallArgs("webcrypto", "plugin", "api", "import-key", [
                privateKey,
            ]),
        );
    }

    importTemporary(privateKey: string): string {
        return this.supervisorCall(
            getCallArgs("webcrypto", "plugin", "api", "importTemporary", [
                privateKey,
            ]),
        );
    }

    signExplicit(msg: Uint8Array, privateKey: string): Uint8Array {
        // future: call out to SubtleCrypto
        return this.supervisorCall(
            getCallArgs("webcrypto", "plugin", "api", "sign-explicit", [
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
                "plugin-ref",
                args.handle,
                "get-service",
                [],
            ),
        );
        const plugin = this.supervisorResourceCall(
            getResourceCallArgs(
                "host",
                "types",
                "api",
                "plugin-ref",
                args.handle,
                "get-plugin",
                [],
            ),
        );
        const intf = this.supervisorResourceCall(
            getResourceCallArgs(
                "host",
                "types",
                "api",
                "plugin-ref",
                args.handle,
                "get-intf",
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
            this.plugins.disposeAll();
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
            this.plugins.disposeAll();
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

            // This is the time-intensive step. It includes: downloading, parsing, and transpiling the
            //   each plugin component. Everything needed to prepare for instantiation and execution.
            // UIs can use `preloadPlugins` to decouple this task from the actual call to the plugin.
            await this.preload([
                {
                    service: args.service,
                    plugin: args.plugin,
                },
            ]);

            await this.plugins.instantiateAll();

            this.context = this.getCallContext();

            // Starts the tx context.
            this.supervisorCall(
                getCallArgs("transact", "plugin", "admin", "start-tx", []),
            );

            // Make a *synchronous* call into the plugin. It can be fully synchronous since everything was
            //   preloaded.
            const result = this.call(args);

            // Closes the current tx context. If actions were added, tx is submitted.
            const txResult = this.supervisorCall(
                getCallArgs("transact", "plugin", "admin", "finish-tx", []),
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
            this.plugins.disposeAll();
        }
    }
}
