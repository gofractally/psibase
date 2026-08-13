import { QualifiedPluginId } from "@psibase/common-lib";

import { assert } from "@/utils";

import { ServiceMap } from "../component-loading/loader";
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

    public collectWasmPlugins(): {
        service: string;
        plugin: string;
        wasm: Uint8Array;
    }[] {
        const out: { service: string; plugin: string; wasm: Uint8Array }[] = [];
        for (const ctx of Object.values(this.serviceContexts)) {
            for (const plugin of ctx.listPlugins()) {
                const wasm = plugin.getBytes?.();
                if (wasm) {
                    out.push({
                        service: plugin.id.service,
                        plugin: plugin.id.plugin,
                        wasm,
                    });
                }
            }
        }
        return out;
    }

    public allPlugins(): Plugin[] {
        return Object.values(this.serviceContexts).flatMap((c) => c.listPlugins());
    }

    public async mergedServiceMap(): Promise<ServiceMap> {
        const merged: ServiceMap = {};
        const maps = await Promise.all(
            this.allPlugins().map((p) => p.services),
        );
        for (const map of maps) {
            if (map) Object.assign(merged, map);
        }
        return merged;
    }

    async compileUncompiled(): Promise<void> {
        await Promise.all(
            this.allPlugins()
                .filter(
                    (p) =>
                        typeof p.isCompiled === "function" && !p.isCompiled(),
                )
                .map((p) => p.compileIndividual()),
        );
    }

    // Instantiates all plugins that have been loaded.
    // This is required before any plugin functions can be executed.
    //
    // Plugins are left instantiated - callers must explicitly dispose of them
    //   using `disposeAll` to properly clean up and free their memory.
    public async instantiateAll(): Promise<void> {
        await Promise.all(
            Object.values(this.serviceContexts).map((c) => c.instantiateAll()),
        );
    }

    // Dispose of *every* instantiated wasm. `compiledPlugin` references are
    //   preserved on each Plugin, so bfcache restore can re-instantiate
    //   without re-fetching or re-compiling.
    //
    // This allows the gc to reclaim memory associated with the instantiated
    //   plugins.
    public disposeAll(): string[] {
        return Object.values(this.serviceContexts).flatMap((c) =>
            c.disposeAll(),
        );
    }
}
