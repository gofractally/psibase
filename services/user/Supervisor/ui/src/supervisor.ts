import {
    QualifiedPluginId,
    QualifiedFunctionCallArgs,
    siblingUrl,
    FunctionCallArgs,
    buildFunctionCallResponse,
    uint8ArrayToHex,
    getTaposForHeadBlock,
    signAndPushTransaction,
} from "@psibase/common-lib";

import { CallStack } from "./callStack";
import { AppInterface } from "./appInterace";
import { AddableAction } from "@psibase/supervisor-lib/messaging/PluginCallResponse";
import { ServiceContext } from "./serviceContext";
import { OriginationData, assert, parser, serviceFromOrigin } from "./utils";
import { Plugin } from "./plugin/plugin";
import { CallContext } from "./callContext";
import { PluginHost } from "./pluginHost";

const supervisorDomain = siblingUrl(null, "supervisor");

// The supervisor facilitates all communication 
export class Supervisor implements AppInterface {
    private serviceContexts: { [service: string]: ServiceContext } = {};

    private callstack: CallStack;

    private activeContext: CallContext | undefined;

    parser: Promise<any>;

    parentOrigination: OriginationData | undefined;

    private setParentOrigination(callerOrigin: string) {
        assert(this.parentOrigination === undefined 
            || this.parentOrigination.origin === callerOrigin, 
            "Redundant setting parent origination");
        
        if (callerOrigin === supervisorDomain) {
            console.info("TODO: handle calls directly from the rootdomain itself");
        }
        this.parentOrigination = {app: serviceFromOrigin(callerOrigin), origin: callerOrigin};
    }

    private loadContext(service: string): ServiceContext {
        if (!this.serviceContexts[service]) {
            this.serviceContexts[service] = new ServiceContext(
                service,
                new PluginHost(this, {app: service, origin: siblingUrl(null, service)}),
            );
        }
        return this.serviceContexts[service];
    }

    // A valid plugin ID implies that it should be loaded as a distinct plugin
    //   Therefore we should not validate wasi interfaces or direct host exports
    private validated(id: QualifiedPluginId): boolean {
        return id.service !== "wasi" && id.service !== "common";
    }

    private async getDependencies(plugin: Plugin): Promise<QualifiedPluginId[]> {
        const dependencies = await plugin.getDependencies();
        return dependencies.filter(id => this.validated(id));
    }

    private async loadPlugins(plugins: QualifiedPluginId[]) {
        if (plugins.length === 0) return;

        let addedPlugins: Plugin[] = [];
        plugins.forEach(({ service, plugin }) => {
            const c = this.loadContext(service);
            const loaded = c.loadPlugin(plugin);
            if (loaded.new) {
                addedPlugins.push(loaded.plugin);
            }
        });

        const imports = await Promise.all(addedPlugins.map(plugin => this.getDependencies(plugin)));
        const dependencies = [...new Set(imports.flat())];

        const pluginsReady = Promise.all(addedPlugins.map(plugin => plugin.ready));
        await Promise.all([pluginsReady, this.loadPlugins(dependencies)]);
    }

    private replyToParent(call: FunctionCallArgs, result: any) {
        window.parent.postMessage(
            buildFunctionCallResponse(call, result),
            this.parentOrigination!.origin,
        );
    }

    constructor() {
        this.parser = parser();
        this.callstack = new CallStack();
    }

    // Called by the plugin on top of the callstack looking to identify its caller
    getCaller(currentPlugin: OriginationData): OriginationData | undefined {
        const frame = this.callstack.peek(0);
        assert(frame !== undefined, "`getCaller` invalid outside plugin call resolution");
        assert(frame!.args.service === currentPlugin.app, "Only active plugin can ask for its caller");
        return frame!.caller;
    }

    // Tracks actions that plugins scheduled to be added to the transaction
    addAction(sender: OriginationData, action: AddableAction) {
        const frame = this.callstack.peek(0);
        assert(frame !== undefined, "Can only add actions during plugin call resolution");
        assert(frame!.args.service === sender.app, "Invalid service attempted to add action");
        this.activeContext!.addAction(action);
    }

    // Manages callstack and calls plugins
    call(sender: OriginationData, args: QualifiedFunctionCallArgs) : any {

        if (this.callstack.isEmpty()) {
            assert(sender.origin === this.parentOrigination!.origin, "Parent origin mismatch");
        } else {
            assert(sender.app !== undefined, "Cannot determine caller service");
            assert(sender.app === this.callstack.peek(0)!.args.service, "Invalid sync call sender");
        }

        this.callstack.push(sender, args);

        const {service, plugin, intf, method, params} = args;
        const p = this.loadContext(service).loadPlugin(plugin);
        assert(p.new === false, "Tried to call plugin before initialization");
        const ret = p.plugin.call(intf, method, params);

        this.callstack.pop();

        return ret;
    }

    // Temporary tx submission logic, until smart auth is implemented
    // All transactions are sent by "alice"
    async submitTx() {
        const actions = this.activeContext!.actions;
        if (actions.length <= 0) return;
        
        let formatted = actions.map((a: AddableAction) => {
            return {
                sender: "alice",
                service: a.service,
                method: a.action,
                rawData: uint8ArrayToHex(a.args),
            };
        });
        const tenSeconds = 10000;
        const transaction: any = {
            tapos: {
                ...(await getTaposForHeadBlock(supervisorDomain)),
                expiration: new Date(Date.now() + tenSeconds),
            },
            actions: formatted,
        };
        await signAndPushTransaction(supervisorDomain, transaction, []);
    }

    // This is an entrypoint for apps to preload plugins.
    // Intended to be used on pageload to prepare the plugins that an app requires,
    //   which accelerates the responsiveness of the plugins for subsequent calls.
    async preloadPlugins(callerOrigin: string, plugins: QualifiedPluginId[]) {
        try {
            //
            this.setParentOrigination(callerOrigin);
            await this.loadPlugins(plugins);
        } catch (e) {
            console.error("Error in supervisor caught. TODO: return error to parent window", e);
        }
    }

    // This is an entrypoint for apps to call into plugins.
    // Sync calls between plugins should use `syncCall`.
    async entry(callerOrigin: string, args: QualifiedFunctionCallArgs): Promise<any> {
        try {
            // Handle if a call is already in progress
            // TODO - Buffer multiple calls from root app
            assert(this.activeContext === undefined, `Plugin call resolution already in progress.`)
            this.activeContext = new CallContext();

            // Store the origin of the root app. That should be the one-and-only root app that ever tries
            //      to interact with this supervisor.
            this.setParentOrigination(callerOrigin);

            // Wait to load the full plugin tree (a plugin and all it's dependencies, recursively).
            // This is the time-intensive step. It includes: downloading, parsing, generating import fills, 
            //   transpiling the component, bundling with rollup, and importing & instantiating the es module 
            //   in memory.
            // Use `preloadPlugins` to decouple this task from the actual call to the plugin.
            await this.loadPlugins([{
                service: args.service,
                plugin: args.plugin, 
            }]);

            // Make a *synchronous* call into the plugin. It can be fully synchronous since everything was 
            //   preloaded.
            // TODO: Consider if a plugin runs an infinite loop. We need a way to terminate the
            //   current call and report the faulty plugin.
            const result = this.call(this.parentOrigination!, args);

            // Post execution assertions
            assert(this.callstack.isEmpty(), "Callstack should be empty");

            // Send plugin result to parent window
            this.replyToParent(args, result);

            // Pack any scheduled actions into a transaction and submit
            this.submitTx();

            this.activeContext = undefined;
        } catch (e) {
            console.error("Error in supervisor caught. TODO: return error to parent window", e);
            this.activeContext = undefined;
        }
    }
}
