import { QualifiedPluginId } from "@psibase/common-lib";

import { assert } from "@/utils";

import { Supervisor } from "../supervisor";
import { Plugin } from "./plugin";
import { PluginHost } from "./pluginHost";
import { LoadedPlugin, ServiceContext } from "./serviceContext";

export class Plugins {
    private supervisor: Supervisor;

    private serviceContexts: { [service: string]: ServiceContext } = {};

    private getServiceContext(service: string): ServiceContext {
        if (!this.serviceContexts[service]) {
            this.serviceContexts[service] = new ServiceContext(
                service,
                new PluginHost(this.supervisor),
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

    public getAssertPlugin(plugin: QualifiedPluginId): Plugin {
        const loaded = this.getServiceContext(plugin.service).loadPlugin(
            plugin.plugin,
        );
        assert(
            loaded.new === false,
            `Tried to call plugin ${plugin.service}:${plugin.plugin} before initialization`,
        );
        return loaded.plugin;
    }
}
