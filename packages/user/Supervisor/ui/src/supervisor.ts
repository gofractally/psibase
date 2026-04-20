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

// Adding here costs every entry the work of compiling + instantiating it.
const systemPlugins: Array<QualifiedPluginId> = [
    pluginId("accounts", "plugin"),
    pluginId("host", "auth"),
    pluginId("host", "prompt"),
    pluginId("transact", "plugin"),
    pluginId("clientdata", "plugin"),
    pluginId("webcrypto", "plugin"),
];

/**
 * Plugin lifecycle is call-scoped. See plugin/plugin.ts memory-model header
 * for the VAS rationale, and the PR / issue history for the failure modes.
 *
 * Invariants:
 *   - Keep fetch/compile separate from instantiate; do not instantiate in
 *     Plugin construction or in Plugin.ready.
 *   - Every entrypoint that instantiates must dispose in `finally` (success
 *     and error). doPreload leaves Phase-0 instances live for its own sync
 *     calls; the entrypoint releases them.
 *   - No cross-entry caches of plugin instances: concurrent entries (from
 *     un-awaited postMessage dispatch) would race over shared lifecycle.
 */
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

        // Phase 0 instantiates because the supervisorCall()s below need
        // live targets; the entrypoint's finally disposes them.
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

        // Phases 1+2 compile only; instantiation is deferred to entry().
        this.loader.trackPlugins([...plugins]);
        await this.loader.processPlugins();
        await this.loader.awaitReady();

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
        this.parser = parser();
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
            this.plugins.disposeAll();
        }
    }

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
            this.plugins.disposeAll();
        }
    }

    /** See main.ts pagehide handler. Idempotent. */
    shutdown(): string[] {
        return this.plugins.disposeAll();
    }

    async entry(
        callerOrigin: string,
        id: string,
        args: QualifiedFunctionCallArgs,
    ): Promise<any> {
        const entryLabel = `${args.service}:${args.plugin} ${
            args.intf ? `${args.intf}.` : ""
        }${args.method}`;

        try {
            this.setParentOrigination(callerOrigin);

            await this.preload(
                [
                    {
                        service: args.service,
                        plugin: args.plugin,
                    },
                ],
                `entry:${entryLabel}`,
            );

            await this.plugins.ensureAllInstantiated();

            this.context = this.getCallContext();

            this.supervisorCall(
                getCallArgs("transact", "plugin", "admin", "startTx", []),
            );

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
            // Also catches partial-instantiation failures from Phase 0.
            this.plugins.disposeAll();
        }
    }
}
