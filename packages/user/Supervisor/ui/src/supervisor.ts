import {
    QualifiedFunctionCallArgs,
    QualifiedPluginId,
    assertTruthy,
    buildFunctionCallResponse,
    encodePromptRedirectMessage,
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
import { slog, watchHang } from "./debug";
import { CallContext } from "./call-context";
import { toPostableError } from "./plugin/errors";
import { PluginLoader } from "./plugin/plugin-loader";
import { Plugins } from "./plugin/plugins";
import {
    PromptSignal,
    peekPromptSignal,
    promptSignalKind,
    setPromptSignal,
    takePromptSignal,
} from "./prompt-signal";
import {
    packedContextToBase64,
    promptDetailsFromTopUrl,
} from "./prompt-url";
import {
    OriginationData,
    assert,
    chainIdPromise,
    isEmbedded,
    networkName,
    networkNamePromise,
    parser,
    serviceFromOrigin,
    setQueryToken,
    afterMacrotask,
    settleWith,
} from "./utils";

const rootDomain = siblingUrl();

// System plugins are always loaded, even if they are not used
//   in a given call context.
const systemPlugins: Array<QualifiedPluginId> = [
    pluginId("accounts", "plugin"),
    pluginId("accounts", "query"),
    pluginId("host", "auth"),
    pluginId("host", "prompt"),
    pluginId("transact", "plugin"),
    pluginId("clientdata", "plugin"),
    pluginId("webcrypto", "plugin"),
];

// The supervisor facilitates all communication
export class Supervisor implements AppInterface {
    private plugins: Plugins;

    private context: CallContext | undefined;

    private embedder: string | undefined;

    private inPreload = false;

    private neededPluginIds: QualifiedPluginId[] = [];

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

        const service = serviceFromOrigin(callerOrigin);

        if (service === networkName) {
            this.parentOrigination = {
                app: "homepage",
                origin: callerOrigin,
            };
        } else {
            this.parentOrigination = {
                app: service,
                origin: callerOrigin,
            };
        }
    }

    // Compile (download + parse + jco transpile) without instantiating.
    // Uses a fresh PluginLoader so a background warmup of unrelated plugins
    // cannot make a user-facing call wait on that extra compile.
    private async compilePlugins(
        plugins: QualifiedPluginId[],
    ): Promise<QualifiedPluginId[]> {
        if (plugins.length === 0) {
            return [];
        }
        const loader = new PluginLoader(this.plugins);
        loader.trackPlugins(plugins);
        await loader.processPlugins();
        await loader.awaitReady();
        return loader.loadedIds();
    }

    startBackgroundCompile(): void {
        slog("background compile start");
        void parser();
        void this.compilePlugins([
            ...systemPlugins,
            pluginId("branding", "plugin"),
        ]).then(
            () => slog("background compile system+branding done"),
            (e) => console.error("Supervisor plugin warmup failed", e),
        );
        void this.compilePlugins([pluginId("invite", "plugin")]).then(
            () => slog("background compile invite done"),
            (e) => console.error("Supervisor invite warmup failed", e),
        );
    }

    // This step loads the full plugin tree (downloading + parsing + JCO transpiling)
    //
    // This does not instantiate wasms, with the exception of core system plugin wasms,
    //   which are instantiated as they are required to be executed during the preloading
    //   of all other plugins.
    //
    // The caller should dispose of all instantiated plugins after the entry function
    //  finishes.
    private preload(plugins: QualifiedPluginId[]): Promise<void> {
        return this.doPreload(plugins);
    }

    private async doPreload(plugins: QualifiedPluginId[]) {
        this.inPreload = true;
        try {
            await chainIdPromise;

            if (plugins.length === 0) {
                return;
            }

            // Phase 0: Loads systemPlugins, including those needed to get current user, i.e., accounts, host:auth
            const systemIds = await this.compilePlugins([...systemPlugins]);

            // Required to instantiate system plugins to execute the plugin calls below
            await this.plugins.instantiate(systemIds);

            if (isEmbedded) {
                const promptDetails = await this.supervisorCall(
                    getCallArgs(
                        "host",
                        "prompt",
                        "admin",
                        "get-active-prompt",
                        [],
                    ),
                );
                if (promptDetails) {
                    this.embedder = promptDetails.activeApp;
                    delete this.context; // A new one will be created with the embedder
                }
            }

            setQueryToken(await this.getActiveQueryToken());

            // Phase 1: Compile app plugins (NO instantiation yet — Memory deferred).
            // The sync call to getAuthServices below only touches Phase 0 plugins.
            const appIds = await this.compilePlugins([...plugins]);

            // Phase 2: Load the auth services for all connected accounts.
            // This sync call uses accounts:plugin (Phase 0, already instantiated).
            const auth_services: string[] = await this.supervisorCall(
                getCallArgs(
                    "accounts",
                    "plugin",
                    "admin",
                    "get-auth-services",
                    [],
                ),
            );

            const addtl_plugins: QualifiedPluginId[] = [];
            for (const service of auth_services) {
                if (!service) continue;

                // Current limitation: an auth service plugin must be called "plugin" ("<service>:plugin")
                addtl_plugins.push(pluginId(service, "plugin"));
            }
            const authIds = await this.compilePlugins(addtl_plugins);
            this.neededPluginIds = [...systemIds, ...appIds, ...authIds];
        } finally {
            this.inPreload = false;
        }
    }

    private replyToParent(id: string, result: any) {
        assertTruthy(this.parentOrigination, "Unknown reply target");
        // Safari structured-clone of Error drops non-enumerable message/payload.
        const payload = result instanceof Error ? toPostableError(result) : result;
        window.parent.postMessage(
            buildFunctionCallResponse(id, payload),
            this.parentOrigination.origin,
        );
    }

    private supervisorCall(callArgs: QualifiedFunctionCallArgs): any {
        const context = this.getCallContext();
        context.stack.push("supervisor", "callFunction");
        try {
            return settleWith(this.call(callArgs), () => context.stack.pop());
        } catch (e) {
            context.stack.pop();
            throw e;
        }
    }

    private supervisorResourceCall(callArgs: QualifiedResourceCallArgs): any {
        const context = this.getCallContext();
        context.stack.push("supervisor", "callResource");
        try {
            return settleWith(this.callResource(callArgs), () =>
                context.stack.pop(),
            );
        } catch (e) {
            context.stack.pop();
            throw e;
        }
    }

    private async getActiveQueryToken(): Promise<string | undefined> {
        assertTruthy(this.parentOrigination, "Parent origination corrupted");
        assertTruthy(this.parentOrigination.app, "Root app unrecognized");

        const user = await this.supervisorCall(
            getCallArgs("accounts", "query", "api", "get-current-user", []),
        );

        if (!user) {
            return undefined;
        }

        const token = await this.supervisorCall(
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

    importKeyTransient(privateKey: string): string {
        return this.supervisorCall(
            getCallArgs("webcrypto", "plugin", "api", "import-key-transient", [
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

    requestPrompt(): never {
        const signal = new PromptSignal(
            this.inPreload
                ? "preload-error"
                : isEmbedded
                  ? "embedded-error"
                  : "prompt",
        );
        setPromptSignal(signal);
        throw signal;
    }

    call(args: QualifiedFunctionCallArgs): any {
        assertTruthy(this.context, "Uninitialized call context");

        const { service, plugin, intf, method, params } = args;
        if (service === "host" && plugin === "prompt") {
            const fromUrl = promptDetailsFromTopUrl();
            if (fromUrl) {
                if (method === "get-active-prompt") {
                    return fromUrl;
                }
                if (method === "get-context" && fromUrl.packedContext) {
                    return fromUrl.packedContext;
                }
            }
        }
        const p = this.plugins.getAssertPlugin({ service, plugin });

        this.context.stack.push(args.service, toString(args));
        try {
            return settleWith(p.call(intf, method, params), () =>
                this.context!.stack.pop(),
            );
        } catch (e) {
            this.context.stack.pop();
            throw e;
        }
    }

    // PluginRef getters are host:types (sync). The target hook may be a
    // promising export (auth-sig claim/proof do HTTP); Plugin.call detaches
    // those onto a macrotask so WebKit JSPI is not nested.
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

        slog(`callDyn ${service}:${plugin}/${intf}->${args.method}`);
        return this.call(
            getCallArgs(service, plugin, intf, args.method, args.params),
        );
    }

    callResource(args: QualifiedResourceCallArgs): any {
        assertTruthy(this.context, "Uninitialized call context");
        const { service, plugin, intf, type, handle, method, params } = args;
        const p = this.plugins.getAssertPlugin({ service, plugin });

        this.context.stack.push(service, toString(args));
        try {
            return settleWith(
                p.resourceCall(intf, type, handle, method, params),
                () => this.context!.stack.pop(),
            );
        } catch (e) {
            this.context.stack.pop();
            throw e;
        }
    }

    private cleanupSessionState(): void {
        this.context = undefined;
        this.parentOrigination = undefined;
        this.embedder = undefined;
    }

    // This is an entrypoint that returns the JSON interface for a plugin.
    async getJson(callerOrigin: string, id: string, plugin: QualifiedPluginId) {
        try {
            await networkNamePromise;
            this.setParentOrigination(callerOrigin);
            await this.preload([plugin]);
            const json = this.plugins.getPlugin(plugin).plugin.getJson();
            this.replyToParent(id, json);
        } catch (e) {
            this.replyToParent(id, toPostableError(e));
        } finally {
            this.plugins.disposeAll();
            this.cleanupSessionState();
        }
    }

    // This is an entrypoint for apps to preload plugins.
    // Intended to be used on pageload to prepare the plugins that an app requires,
    //   which accelerates the responsiveness of the plugins for subsequent calls.
    async preloadPlugins(
        callerOrigin: string,
        id: string,
        plugins: QualifiedPluginId[],
    ) {
        let result: unknown = null;
        try {
            await networkNamePromise;
            this.setParentOrigination(callerOrigin);
            await this.preload(plugins);
        } catch (e) {
            result = toPostableError(e);
        } finally {
            this.plugins.disposeAll();
            this.replyToParent(id, result);
            this.cleanupSessionState();
        }
    }

    // This is an entrypoint for apps to call into plugins.
    async entry(
        callerOrigin: string,
        id: string,
        args: QualifiedFunctionCallArgs,
    ): Promise<any> {
        const callLabel = `${args.service}:${args.plugin}/${args.intf ?? ""}->${args.method}`;
        slog(`entry ${callLabel}`, { id, origin: callerOrigin });
        try {
            await networkNamePromise;
            this.setParentOrigination(callerOrigin);

            // This is the time-intensive step. It includes: downloading, parsing, and transpiling the
            //   each plugin component. Everything needed to prepare for instantiation and execution.
            // UIs can use `preloadPlugins` to decouple this task from the actual call to the plugin.
            await watchHang(`preload ${callLabel}`, () =>
                this.preload([
                    {
                        service: args.service,
                        plugin: args.plugin,
                    },
                ]),
            );

            await watchHang(`instantiate ${callLabel}`, () =>
                this.plugins.instantiate(this.neededPluginIds),
            );

            this.context = this.getCallContext();

            // Starts the tx context.
            await watchHang(`start-tx for ${callLabel}`, () =>
                this.supervisorCall(
                    getCallArgs("transact", "plugin", "admin", "start-tx", []),
                ),
            );

            // Plugin code is still written synchronously. JSPI suspends the wasm
            // stack across fetch() (and other Promise-returning host imports).
            const result = await watchHang(`plugin ${callLabel}`, () =>
                this.call(args),
            );
            if (peekPromptSignal()) {
                slog(`prompt signal after ${callLabel}`);
                throw peekPromptSignal();
            }

            // Nested transact get-query-token (login cookie) during connectAccount
            // can leave jco's component task busy. Yield so finish-tx can start.
            slog(`yield before finish-tx for ${callLabel}`);
            await afterMacrotask();
            await afterMacrotask();

            // Closes the current tx context. If actions were added, tx is submitted.
            const txResult = await watchHang(`finish-tx for ${callLabel}`, () =>
                this.supervisorCall(
                    getCallArgs("transact", "plugin", "admin", "finish-tx", []),
                ),
            );
            if (txResult !== null && txResult !== undefined) {
                console.warn(txResult);
            }

            slog(`reply success ${callLabel}`);
            // Send plugin result to parent window
            this.replyToParent(id, result);
        } catch (e) {
            let result: any;
            const promptKind = promptSignalKind(e) ?? peekPromptSignal()?.kind;
            takePromptSignal();
            if (promptKind === "prompt") {
                let message = "user_prompt_request";
                try {
                    const details = this.supervisorCall(
                        getCallArgs(
                            "host",
                            "prompt",
                            "admin",
                            "get-active-prompt",
                            [],
                        ),
                    );
                    if (details) {
                        message = encodePromptRedirectMessage({
                            promptApp: details.promptApp,
                            promptName: details.promptName,
                            activeApp: details.activeApp,
                            created: details.created,
                            packedContext: packedContextToBase64(
                                details.packedContext,
                            ),
                        });
                    }
                } catch {
                    // Still redirect; prompt.html can recover from URL or show a real error.
                }
                result = new RedirectErrorObject(
                    { service: "host", plugin: "prompt" },
                    message,
                );
            } else if (promptKind === "embedded-error") {
                result = new PluginErrorObject(
                    { service: "host", plugin: "prompt" },
                    "Cannot prompt in embedded mode",
                );
            } else if (promptKind === "preload-error") {
                result = new PluginErrorObject(
                    { service: "host", plugin: "prompt" },
                    "Cannot trigger user prompt during plugin preload",
                );
            } else {
                console.error("Supervisor plugin call failed", e);
                result = toPostableError(e);
            }
            this.replyToParent(id, result);
        } finally {
            // Drop wasm instances after every call so JSPI task state from
            // nested transact get-query-token cannot deadlock a later finish-tx.
            // compiledPlugin is kept, so the next call only re-instantiates.
            this.plugins.disposeAll();
            this.cleanupSessionState();
        }
    }
}
