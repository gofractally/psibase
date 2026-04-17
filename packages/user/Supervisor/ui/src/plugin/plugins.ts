import { QualifiedPluginId, pluginString } from "@psibase/common-lib";

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

    /** Dispose every instantiated, non-pinned plugin so V8 can reclaim
     *  the backing Memory on the next GC. Returns disposed plugin ids. */
    public disposeAllUnpinned(): string[] {
        const disposed: string[] = [];
        this.forEachPlugin((p) => {
            if (p.isInstantiated && !p.pinned) {
                p.dispose();
                disposed.push(pluginString(p.id));
            }
        });
        return disposed;
    }

    /** Dispose every instantiated plugin regardless of pinned state. Used
     *  by the pagehide shutdown path. compiledPlugin handles are retained
     *  so bfcache restore can re-instantiate without re-fetch / re-compile. */
    public disposeAll(): string[] {
        const disposed: string[] = [];
        this.forEachPlugin((p) => {
            if (p.isInstantiated) {
                p.dispose();
                disposed.push(pluginString(p.id));
            }
        });
        return disposed;
    }

    public listInstantiated(): string[] {
        const names: string[] = [];
        this.forEachPlugin((p) => {
            if (p.isInstantiated) names.push(pluginString(p.id));
        });
        return names;
    }
}
