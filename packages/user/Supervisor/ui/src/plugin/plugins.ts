import { QualifiedPluginId } from "@psibase/common-lib";

import { assert } from "@/utils";

import { Supervisor } from "../supervisor";
import { Plugin } from "./plugin";
import { PluginHost } from "./plugin-host";
import { LoadedPlugin, ServiceContext } from "./service-context";

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

    public async ensureAllInstantiated(): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const context of Object.values(this.serviceContexts)) {
            for (const plugin of context.getAllPlugins()) {
                promises.push(plugin.ensureInstantiated());
            }
        }
        await Promise.all(promises);
    }

    public forEachPlugin(callback: (plugin: Plugin) => void): void {
        for (const context of Object.values(this.serviceContexts)) {
            for (const plugin of context.getAllPlugins()) {
                callback(plugin);
            }
        }
    }
}
