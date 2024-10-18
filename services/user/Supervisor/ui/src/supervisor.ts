import type { UUID } from "crypto";

import {
    QualifiedPluginId,
    QualifiedFunctionCallArgs,
    siblingUrl,
    FunctionCallArgs,
    buildFunctionCallResponse,
    PluginError,
} from "@psibase/common-lib";

import { AppInterface } from "./appInterace";
import { ServiceContext } from "./serviceContext";
import {
    OriginationData,
    assert,
    assertTruthy,
    parser,
    serviceFromOrigin,
} from "./utils";
import { Plugin } from "./plugin/plugin";
import { CallContext } from "./callContext";
import { PluginHost } from "./pluginHost";
import { isRecoverableError, PluginDownloadFailed } from "./plugin/errors";
import { getCallArgs } from "@psibase/common-lib/messaging/FunctionCallRequest";
import { getPlugin, isEqual } from "@psibase/common-lib/messaging/PluginId";

const supervisorDomain = siblingUrl(null, "supervisor");
const supervisorOrigination = {
    app: serviceFromOrigin(supervisorDomain),
    origin: supervisorDomain,
};

// User plugins are those that are dynamically loaded based on the currently logged-in user's account
//   configuration. For example, the currently logged-in user may use auth-sig as their auth service,
//   in which case anything that links to the `accounts:smart-auth` plugin will ultimately want to link against
//   the auth-sig plugin.
// This array contains a mapping of the plugin ID that is used for bindings generation at compile time
//   (e.g. accounts:smart-auth) to the plugin ID that is actually linked against. If the mapped plugin is non-null
//   by default, then that default plugin is used when there is no logged-in user.
const defaultUserPlugins = (): Array<
    [QualifiedPluginId, QualifiedPluginId | null]
> => {
    return [
        [
            getPlugin("accounts", "smart-auth"),
            getPlugin("auth-invite", "plugin"),
        ],
    ];
};
let userPlugins: Array<[QualifiedPluginId, QualifiedPluginId | null]> =
    defaultUserPlugins();
let userPluginsDirty = true;

// System plugins are always loaded, even if they are not used
//   in a given call context.
const systemPlugins: Array<QualifiedPluginId> = [
    getPlugin("accounts", "plugin"),
    getPlugin("transact", "plugin"),
];

interface Account {
    accountNum: string;
    authService: string;
    resourceBalance?: number;
}

// The supervisor facilitates all communication
export class Supervisor implements AppInterface {
    private serviceContexts: { [service: string]: ServiceContext } = {};

    private context: CallContext | undefined;

    parser: Promise<any>;

    parentOrigination: OriginationData | undefined;

    private setParentOrigination(callerOrigin: string) {
        assert(
            this.parentOrigination === undefined ||
                this.parentOrigination.origin === callerOrigin,
            "Redundant setting parent origination",
        );

        if (callerOrigin === supervisorDomain) {
            console.info(
                "TODO: handle calls directly from the rootdomain itself",
            );
        }
        this.parentOrigination = {
            app: serviceFromOrigin(callerOrigin),
            origin: callerOrigin,
        };
    }

    private loadContext(service: string): ServiceContext {
        if (!this.serviceContexts[service]) {
            this.serviceContexts[service] = new ServiceContext(
                service,
                new PluginHost(this, {
                    app: service,
                    origin: siblingUrl(null, service),
                }),
            );
        }
        return this.serviceContexts[service];
    }

    private filterHostPlugins(plugins: QualifiedPluginId[]) {
        // Plugins at these namespace are built into the supervisor host itself and
        //  are not pulled from the chain.
        return plugins.filter(
            (id) => id.service !== "wasi" && id.service !== "host",
        );
    }

    private getMapped(
        plugin: QualifiedPluginId,
        map: Array<[QualifiedPluginId, QualifiedPluginId | null]>,
    ): QualifiedPluginId {
        const entry = map.find(
            ([p]) => p.service === plugin.service && p.plugin === plugin.plugin,
        );

        if (!entry) return plugin;

        const [, mappedPlugin] = entry;

        if (!mappedPlugin) {
            throw new Error(
                `Failed to map dynamic plugin: ${plugin.service}:${plugin.plugin}`,
            );
        }

        return mappedPlugin;
    }

    private filterUserPlugins(
        plugins: QualifiedPluginId[],
    ): QualifiedPluginId[] {
        return plugins.map((item) => this.getMapped(item, userPlugins));
    }

    private async getDependencies(
        plugin: Plugin,
    ): Promise<QualifiedPluginId[]> {
        try {
            let dependencies = await plugin.getDependencies();
            dependencies = this.filterUserPlugins(dependencies);
            dependencies = this.filterHostPlugins(dependencies);
            return dependencies;
        } catch (e: any) {
            if (e instanceof PluginDownloadFailed) {
                return [];
            } else {
                throw e;
            }
        }
    }

    private async preload(plugins: QualifiedPluginId[]) {
        await Promise.all([
            this.loadPlugins(plugins),
            this.loadPlugins(systemPlugins),
        ]);

        // Find the user's dynamic plugins
        this.resetUserPlugins();

        // And preload them as well
        const validUserPlugins = userPlugins
            .filter(
                (p): p is [QualifiedPluginId, QualifiedPluginId] =>
                    p[1] !== null,
            )
            .map((p) => p[1]);

        await Promise.all([this.loadPlugins(validUserPlugins)]);
    }

    private async loadPlugins(plugins: QualifiedPluginId[]): Promise<any> {
        if (plugins.length === 0) return;

        const addedPlugins: Plugin[] = [];
        this.filterUserPlugins(plugins);
        plugins.forEach(({ service, plugin }) => {
            const c = this.loadContext(service);
            const loaded = c.loadPlugin(plugin);
            if (loaded.new) {
                addedPlugins.push(loaded.plugin);
            }
        });

        if (addedPlugins.length === 0) return;

        const imports = await Promise.all(
            addedPlugins.map((plugin) => this.getDependencies(plugin)),
        );

        const dependencies = imports
            .flat()
            .reduce((acc: QualifiedPluginId[], current: QualifiedPluginId) => {
                if (!acc.some((obj) => isEqual(obj, current))) {
                    acc.push(current);
                }
                return acc;
            }, []);

        const pluginsReady = Promise.all(
            addedPlugins.map((plugin) => plugin.ready),
        );
        return Promise.all([pluginsReady, this.loadPlugins(dependencies)]);
    }

    private replyToParent(id: UUID, call: FunctionCallArgs, result: any) {
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
            "accounts",
            "getLoggedInUser",
            [],
        );
        return this.supervisorCall(getLoggedInUser);
    }

    constructor() {
        this.parser = parser();
    }

    getActiveAppDomain(sender: OriginationData): string {
        assertTruthy(this.parentOrigination, "Parent origination corrupted");
        assertTruthy(
            sender.app,
            "[supervisor:getActiveAppDomain] Unauthorized - only callable by Accounts plugin",
        );
        assert(
            sender.app === "accounts",
            "[supervisor:getActiveAppDomain] Unauthorized - Only callable by Accounts plugin",
        );

        return this.parentOrigination.origin;
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

    getAccount(user: string): Account {
        assertTruthy(this.parentOrigination, "Parent origination corrupted");

        const getAccount = getCallArgs(
            "accounts",
            "plugin",
            "accounts",
            "getAccount",
            [user],
        );
        let account: Account | undefined = this.supervisorCall(getAccount);
        assertTruthy(account, "User account not found");
        return account;
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

        // Map dynamic user plugins to their corresponding plugin
        const target = this.getMapped(
            getPlugin(args.service, args.plugin),
            userPlugins,
        );
        args.service = target.service;
        args.plugin = target.plugin;

        // Load the plugin
        const { service, plugin, intf, method, params } = args;
        const p = this.loadContext(service).loadPlugin(plugin);
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

    // Plugins that are dynamically loaded based on the current user settings
    private resetUserPlugins() {
        if (!userPluginsDirty) return;
        userPluginsDirty = false;

        let user = this.getLoggedInUser();
        if (user === undefined) {
            userPlugins = defaultUserPlugins();
            return;
        }

        const account = this.getAccount(user);
        userPlugins = [
            [
                getPlugin("accounts", "smart-auth"),
                getPlugin(account.authService, "plugin"), // Implies that the auth service plugin must be called "plugin" ("<namespace>:plugin")
            ],
        ];
    }

    // This is an entrypoint for apps to preload plugins.
    // Intended to be used on pageload to prepare the plugins that an app requires,
    //   which accelerates the responsiveness of the plugins for subsequent calls.
    async preloadPlugins(callerOrigin: string, plugins: QualifiedPluginId[]) {
        try {
            this.setParentOrigination(callerOrigin);
            await this.preload([...plugins]);
        } catch (e) {
            console.error("TODO: Return an error to the caller.");
            console.error(e);
        }
    }

    // This is an entrypoint for apps to call into plugins.
    async entry(
        callerOrigin: string,
        id: UUID,
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
