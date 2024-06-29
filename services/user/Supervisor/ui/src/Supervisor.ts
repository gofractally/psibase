import {
    QualifiedPluginId,
    QualifiedFunctionCallArgs,
    PreLoadPluginsRequest,
    FunctionCallRequest,
} from "@psibase/common-lib";

import { HostInterface } from "./HostInterface";
import { CallContext } from "./CallContext";
import { AppInterface } from "./AppInterace";
import { AddableAction } from "@psibase/supervisor-lib/messaging/PluginCallResponse";
import { ServiceContext } from "./ServiceContext";

// Supervisor could implement this directly, but the separation is cleaner.
class PluginHost implements HostInterface {
    private supervisor: Supervisor;
    constructor(supervisor: Supervisor) {
        this.supervisor = supervisor;
    }

    registerDependencies(
        _origin: string,
        _dependencies: QualifiedPluginId[],
    ): void {
        // TODO
        //this.supervisor.preloadPlugins(dependencies);
    }

    syncCall(origin: string, args: QualifiedFunctionCallArgs): any {
        this.supervisor.callStackContext.assertPluginCallsAllowed();
        this.supervisor.callStackContext.pushCall(origin, args);
        this.supervisor.processTop();
    }

    async setResult(origin: string, result: any) {
        this.supervisor.callStackContext.assertPluginCallsAllowed();
        await this.supervisor.callStackContext.popCall(origin, result);
        this.supervisor.processTop();
    }

    addActions(origin: string, actions: AddableAction[]): void {
        this.supervisor.callStackContext.assertPluginCallsAllowed();
        this.supervisor.callStackContext.addActions(origin, actions);
    }
}

export class Supervisor implements AppInterface {
    private pluginHost: PluginHost = new PluginHost(this);
    private serviceContexts: { [service: string]: ServiceContext } = {};

    callStackContext = new CallContext();

    private callstack = this.callStackContext.callStack;

    async processTop() {
        if (this.callstack.isEmpty()) return;
        let {
            caller,
            args: { service, plugin, intf, method, params },
        } = this.callstack.peek(0)!;

        const p = this.loadContext(service).loadPlugin(plugin);
        let resultCache = this.callStackContext.getCachedResults(
            service,
            plugin,
        );
        p.loadMemory(resultCache);
        await p.call(caller, intf, method, params);
    }

    private loadContext(service: string): ServiceContext {
        if (!this.serviceContexts[service]) {
            this.serviceContexts[service] = new ServiceContext(
                service,
                this.pluginHost,
            );
        }
        return this.serviceContexts[service];
    }

    preloadPlugins(_callerOrigin: string, request: PreLoadPluginsRequest) {
        // TODO --> this.validateOrigin(callerOrigin);
        request.payload.plugins.forEach(({ service, plugin }) => {
            const c = this.loadContext(service);
            c.loadPlugin(plugin);
        });
    }

    // This is the entrypoint for apps to call into plugins.
    call(callerOrigin: string, request: FunctionCallRequest) {
        // this.validateOrigin(callerOrigin);
        if (
            this.callStackContext.isActive() &&
            this.callStackContext.rootAppOrigin === callerOrigin
        ) {
            // There's already an unresolved callstack from this root
            // TODO - Buffer multiple calls from root app
            throw Error(`Plugin call resolution already in progress.`);
        }

        if (!this.callStackContext.isActive()) {
            if (
                this.callStackContext.rootAppOrigin &&
                this.callStackContext.rootAppOrigin !== callerOrigin
            ) {
                // Once there is a root app origin, then there can never be a different root app origin
                // for this supervisor. Loading a new root app would load a new supervisor.
                throw Error(
                    "Cannot have two different root apps using the same supervisor.",
                );
            }
            this.callStackContext.rootAppOrigin = callerOrigin;
        }

        this.callStackContext.pushCall(callerOrigin, request.args);
        this.processTop();
    }
}
