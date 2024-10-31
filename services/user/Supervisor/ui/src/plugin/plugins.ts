import { Supervisor } from "../supervisor";
import { LoadedPlugin, ServiceContext } from "./serviceContext";
import { PluginHost } from "./pluginHost";
import { QualifiedPluginId, siblingUrl } from "@psibase/common-lib";

export class Plugins {
    private supervisor: Supervisor;

    private serviceContexts: { [service: string]: ServiceContext } = {};

    private getServiceContext(service: string): ServiceContext {
        if (!this.serviceContexts[service]) {
            this.serviceContexts[service] = new ServiceContext(
                service,
                new PluginHost(this.supervisor, {
                    app: service,
                    origin: siblingUrl(null, service),
                }),
            );
        }
        return this.serviceContexts[service];
    }

    constructor(supervisor: Supervisor) {
        this.supervisor = supervisor;
    }

    public getPlugin(plugin: QualifiedPluginId): LoadedPlugin {
        return this.getServiceContext(plugin.service).loadPlugin(plugin.plugin);
    }
}
