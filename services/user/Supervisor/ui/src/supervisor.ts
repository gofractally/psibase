import {
    QualifiedFunctionCallArgs,
    QualifiedPluginId,
    assertTruthy,
    buildFunctionCallResponse,
    postGraphQLGetJson,
    siblingUrl,
} from "@psibase/common-lib";
import {
    PluginErrorObject,
    RedirectErrorObject,
} from "@psibase/common-lib/messaging";
import { getCallArgs } from "@psibase/common-lib/messaging/FunctionCallRequest";
import { pluginId } from "@psibase/common-lib/messaging/PluginId";

import { AppInterface } from "./appInterace";
import { CallContext } from "./callContext";
import { REDIRECT_ERROR_CODE } from "./constants";
import { isRecoverableError } from "./plugin/errors";
import { PluginLoader } from "./plugin/pluginLoader";
import { Plugins } from "./plugin/plugins";
import { OriginationData, assert, parser, serviceFromOrigin } from "./utils";

const supervisorDomain = siblingUrl(null, "supervisor");
const supervisorOrigination = {
    app: serviceFromOrigin(supervisorDomain),
    origin: supervisorDomain,
};

// System plugins are always loaded, even if they are not used
//   in a given call context.
const systemPlugins: Array<QualifiedPluginId> = [
    pluginId("accounts", "plugin"),
    pluginId("transact", "plugin"),
    pluginId("clientdata", "plugin"),
];
interface AuthService {
    authService: string;
}

interface GetAccountsResponse {
    data: {
        getAccounts: (AuthService | null)[];
    };
}

// The supervisor facilitates all communication
export class Supervisor implements AppInterface {
    private plugins: Plugins;

    private loader: PluginLoader;

    private context: CallContext | undefined;

    parser: Promise<any>;

    parentOrigination: OriginationData | undefined;

    private setParentOrigination(callerOrigin: string) {
        assert(
            this.parentOrigination === undefined ||
                this.parentOrigination.origin === callerOrigin,
            "Redundant setting parent origination",
        );

        if (callerOrigin === siblingUrl(null, null, null, true)) {
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

    private async preload(plugins: QualifiedPluginId[]) {
        if (plugins.length === 0) {
            return;
        }

        this.loader.trackPlugins([...systemPlugins, ...plugins]);

        // Loading dynamic plugins may require calling into the standard plugins
        //   to look up information to know what plugin to load. Therefore,
        //   loading happens in two phases: Load all regular plugins, then load
        //   all dynamic plugins.

        // Phase 1: Loads plugins requested by an app
        await this.loader.processPlugins();
        await this.loader.awaitReady();

        // Phase 2: Load the auth services for all connected accounts
        const connectedAccounts = this.supervisorCall(
            getCallArgs(
                "accounts",
                "plugin",
                "activeApp",
                "getConnectedAccounts",
                [],
            ),
        );
        if (!connectedAccounts) return;
        const gql_endpoint = siblingUrl(null, "accounts", "/graphql", true);
        const accounts = connectedAccounts
            .map((a: string) => `"${a}"`)
            .join(",");
        const { data } = await postGraphQLGetJson<GetAccountsResponse>(
            gql_endpoint,
            `{
                getAccounts(accounts: [${accounts}]) {
                    authService
                }
            }`,
        );
        const auth_services: (AuthService | null)[] = data?.getAccounts || [];

        const addtl_plugins: QualifiedPluginId[] = [];
        for (const service of auth_services) {
            if (!service) continue;
            addtl_plugins.push(pluginId(service.authService, "plugin"));
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

    public supervisorCall(callArgs: QualifiedFunctionCallArgs): any {
        let newContext = false;
        if (!this.context) {
            newContext = true;
            this.context = new CallContext();
        }

        let ret: any;
        try {
            ret = this.call(supervisorOrigination, callArgs);
        } finally {
            if (newContext) {
                this.context = undefined;
            }
        }

        return ret;
    }

    constructor() {
        this.parser = parser();

        this.plugins = new Plugins(this);

        this.loader = new PluginLoader(this.plugins);
    }

    getActiveApp(sender: OriginationData): OriginationData {
        assertTruthy(this.parentOrigination, "Parent origination corrupted");
        assertTruthy(
            sender.app,
            "[supervisor:getActiveApp] Unauthorized - only callable by privileged plugins",
        );
        assert(
            sender.app === "accounts" || sender.app === "staged-tx",
            "[supervisor:getActiveApp] Unauthorized - Only callable by privileged plugins",
        );

        return this.parentOrigination;
    }

    // Called by the current plugin looking to identify its caller
    getCaller(currentPlugin: OriginationData): OriginationData {
        assertTruthy(this.context, "Uninitialized call context");

        const frame = this.context.stack.peek(0);
        assertTruthy(
            frame,
            "`getCaller` invalid outside plugin call resolution",
        );
        assert(
            frame.args.service === currentPlugin.app,
            "Only active plugin can ask for its caller",
        );
        return frame.caller;
    }

    // Manages callstack and calls plugins
    call(sender: OriginationData, args: QualifiedFunctionCallArgs): any {
        assertTruthy(this.context, "Uninitialized call context");
        assertTruthy(this.parentOrigination, "Uninitialized call origination");

        if (this.context.stack.isEmpty()) {
            assert(
                sender.origin === this.parentOrigination.origin ||
                    sender.origin === supervisorDomain,
                "Invalid call origination",
            );
        } else {
            assertTruthy(sender.app, "Cannot determine caller service");
            assert(
                sender.app === this.context.stack.peek(0)!.args.service ||
                    sender.app === "supervisor",
                "Invalid sync call sender",
            );
        }

        // Load the plugin
        const { service, plugin, intf, method, params } = args;
        const p = this.plugins.getPlugin({ service, plugin });
        assert(
            p.new === false,
            `Tried to call plugin ${service}:${plugin} before initialization`,
        );

        // Manage the callstack and call the plugin
        this.context.stack.push(sender, args);
        let ret: any;
        try {
            ret = p.plugin.call(intf, method, params);
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
            // This is the time-intensive step. It includes: downloading, parsing, generating import fills,
            //   transpiling the component, bundling with rollup, and importing & instantiating the es module
            //   in memory.
            // UIs should use `preloadPlugins` to decouple this task from the actual call to the plugin.
            await this.preload([
                {
                    service: args.service,
                    plugin: args.plugin,
                },
            ]);

            this.context = new CallContext();

            // Make a *synchronous* call into the plugin. It can be fully synchronous since everything was
            //   preloaded.
            assertTruthy(
                this.parentOrigination,
                "Parent origination corrupted",
            );

            // Starts the tx context.
            this.supervisorCall(
                getCallArgs("transact", "plugin", "admin", "startTx", []),
            );

            const result = this.call(this.parentOrigination, args);

            // Closes the current tx context. If actions were added, tx is submitted.
            const txResult = this.supervisorCall(
                getCallArgs("transact", "plugin", "admin", "finishTx", []),
            );
            if (txResult !== null && txResult !== undefined) {
                console.warn(txResult);
            }

            // Post execution assertions
            assert(this.context.stack.isEmpty(), "Callstack should be empty");

            // Send plugin result to parent window
            this.replyToParent(id, result);

            this.context = undefined;
        } catch (e) {
            if (isRecoverableError(e)) {
                // It is only recoverable at intermediate steps in the callstack.
                // Since it is the final return value, it is no longer recoverable and is
                //   converted to a PluginError to be handled by the client.
                let newError;
                if (e.payload.code === REDIRECT_ERROR_CODE) {
                    newError = new RedirectErrorObject(
                        e.payload.producer,
                        e.payload.message,
                    );
                } else {
                    newError = new PluginErrorObject(
                        e.payload.producer,
                        e.payload.message,
                    );
                }
                this.replyToParent(id, newError);
            } else {
                this.replyToParent(id, e);
            }

            this.context = undefined;
        }
    }
}
