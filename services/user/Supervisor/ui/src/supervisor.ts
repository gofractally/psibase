import {
    QualifiedPluginId,
    QualifiedFunctionCallArgs,
    siblingUrl,
    FunctionCallArgs,
    buildFunctionCallResponse,
    PluginError,
} from "@psibase/common-lib";

import { AppInterface } from "./appInterace";
import {
    OriginationData,
    assert,
    assertTruthy,
    parser,
    serviceFromOrigin,
} from "./utils";
import { CallContext } from "./callContext";
import { isRecoverableError } from "./plugin/errors";
import { getCallArgs } from "@psibase/common-lib/messaging/FunctionCallRequest";
import { pluginId } from "@psibase/common-lib/messaging/PluginId";
import { Plugins } from "./plugin/plugins";
import { PluginLoader } from "./plugin/pluginLoader";

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
];

interface Account {
    accountNum: string;
    authService: string;
    resourceBalance?: number;
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

        this.parentOrigination = {
            app: callerOrigin === siblingUrl(null, null, null, true) ? "homepage" : serviceFromOrigin(callerOrigin),
            origin: callerOrigin,
        };
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

        // Phase 1: Loads all regular plugins
        await this.loader.processPlugins();
        await this.loader.awaitReady();

        // Phase 2: Loads all dynamic plugins
        await this.loader.processDeferred();
        await this.loader.awaitReady();
    }

    private replyToParent(id: string, call: FunctionCallArgs, result: any) {
        assertTruthy(this.parentOrigination, "Unknown reply target");
        window.parent.postMessage(
            buildFunctionCallResponse(id, call, result),
            this.parentOrigination.origin,
        );
    }

    private supervisorCall(callArgs: QualifiedFunctionCallArgs): any {
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

    private getLoggedInUser(): string | undefined {
        assertTruthy(this.parentOrigination, "Parent origination corrupted");

        let getLoggedInUser = getCallArgs(
            "accounts",
            "plugin",
            "activeApp",
            "getLoggedInUser",
            [],
        );
        return this.supervisorCall(getLoggedInUser);
    }

    private getAccount(user: string): Account | undefined {
        assertTruthy(this.parentOrigination, "Parent origination corrupted");

        const getAccount = getCallArgs(
            "accounts",
            "plugin",
            "api",
            "getAccount",
            [user],
        );
        let account: Account | undefined = this.supervisorCall(getAccount);
        return account;
    }

    private logout() {
        assertTruthy(this.parentOrigination, "Parent origination corrupted");

        const logout = getCallArgs(
            "accounts",
            "plugin",
            "activeApp",
            "logout",
            [],
        );

        this.supervisorCall(logout);
    }

    constructor() {
        this.parser = parser();

        this.plugins = new Plugins(this);

        this.loader = new PluginLoader(this.plugins);
        this.loader.registerDynamic(pluginId("accounts", "smart-auth"), () => {
            let user = this.getLoggedInUser();
            if (user === undefined) {
                return pluginId("auth-invite", "plugin");
            }
            const account = this.getAccount(user);
            if (account === undefined) {
                console.warn(
                    `Invalid user account '${user}' detected. Automatically logging out.`,
                );
                this.logout();
                return pluginId("auth-invite", "plugin");
            }
            // Temporary limitation: the auth service plugin must be called "plugin" ("<namespace>:plugin")
            // Or, we could just eliminate the possiblity of storing multiple plugins per namespace (and *everything*
            //   would have to be named "plugin")
            return pluginId(account.authService, "plugin");
        });
    }

    getActiveApp(sender: OriginationData): OriginationData {
        assertTruthy(this.parentOrigination, "Parent origination corrupted");
        assertTruthy(
            sender.app,
            "[supervisor:getActiveApp] Unauthorized - only callable by Accounts plugin",
        );
        assert(
            sender.app === "accounts",
            "[supervisor:getActiveApp] Unauthorized - Only callable by Accounts plugin",
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
            this.replyToParent(id, args, result);

            this.context = undefined;
        } catch (e) {
            if (isRecoverableError(e)) {
                // It is only recoverable at intermediate steps in the callstack.
                // Since it is the final return value, it is no longer recoverable and is
                //   converted to a PluginError to be handled by the client.
                this.replyToParent(
                    id,
                    args,
                    new PluginError(e.payload.producer, e.payload.message),
                );
            } else {
                this.replyToParent(id, args, e);
            }

            this.context = undefined;
        }
    }
}
