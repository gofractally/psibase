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
import { isEqual } from "@psibase/common-lib/messaging/PluginId";

const supervisorDomain = siblingUrl(null, "supervisor");
const supervisorOrigination = {
    app: serviceFromOrigin(supervisorDomain),
    origin: supervisorDomain,
};
const systemPlugins: Array<QualifiedPluginId> = [
    {
        service: "accounts",
        plugin: "plugin",
    },
    {
        service: "transact",
        plugin: "plugin",
    },
];

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

    // A valid plugin ID implies that it should be loaded as a distinct plugin
    //   Therefore we should not validate wasi interfaces or direct host exports
    private validated(id: QualifiedPluginId): boolean {
        return id.service !== "wasi" && id.service !== "host";
    }

    private async getDependencies(
        plugin: Plugin,
    ): Promise<QualifiedPluginId[]> {
        try {
            const dependencies = await plugin.getDependencies();
            return dependencies.filter((id) => this.validated(id));
        } catch (e: any) {
            if (e instanceof PluginDownloadFailed) {
                return [];
            } else {
                throw e;
            }
        }
    }

    private async preload(callerOrigin: string, plugins: QualifiedPluginId[]) {
        this.setParentOrigination(callerOrigin);
        await Promise.all([this.loadPlugins(plugins)]);
    }

    private async loadPlugins(plugins: QualifiedPluginId[]): Promise<any> {
        if (plugins.length === 0) return;

        const addedPlugins: Plugin[] = [];
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
        return this.call(supervisorOrigination, callArgs);
    }

    constructor() {
        this.parser = parser();
    }

    // Temporary function to allow apps to directly log a user in
    loginTemp(appOrigin: string, user: string, sender: OriginationData) {
        assertTruthy(this.parentOrigination, "Parent origination corrupted");
        assertTruthy(
            sender.app,
            "[supervisor:loginTemp] only callable by Accounts plugin",
        );

        assert(
            sender.app === "accounts",
            "[supervisor:loginTemp] Unauthorized",
        );
        assert(
            appOrigin === this.parentOrigination.origin,
            "[supervisor:loginTemp] Unauthorized. Can only login to top-level app.",
        );

        let login = getCallArgs("accounts", "plugin", "admin", "forceLogin", [
            appOrigin,
            user,
        ]);
        this.supervisorCall(login);
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

    getLoggedInUser(caller_app: string): string | undefined {
        assertTruthy(this.parentOrigination, "Parent origination corrupted");

        let getLoggedInUser = getCallArgs(
            "accounts",
            "plugin",
            "admin",
            "getLoggedInUser",
            [caller_app, this.parentOrigination.origin],
        );
        return this.supervisorCall(getLoggedInUser);
    }

    isLoggedIn(): boolean {
        return this.getLoggedInUser("supervisor") !== undefined;
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

        const { service, plugin, intf, method, params } = args;
        const p = this.loadContext(service).loadPlugin(plugin);
        assert(
            p.new === false,
            `Tried to call plugin ${service}:${plugin} before initialization`,
        );

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
            this.preload(callerOrigin, [...plugins, ...systemPlugins]);
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
            // Wait to load the full plugin tree (a plugin and all it's dependencies, recursively).
            // This is the time-intensive step. It includes: downloading, parsing, generating import fills,
            //   transpiling the component, bundling with rollup, and importing & instantiating the es module
            //   in memory.
            // UIs should use `preloadPlugins` to decouple this task from the actual call to the plugin.
            await this.preload(callerOrigin, [
                {
                    service: args.service,
                    plugin: args.plugin,
                },
                ...systemPlugins,
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
