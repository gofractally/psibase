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

    /**
     * Dispose every instantiated, non-pinned plugin so that V8 can reclaim
     * the backing WebAssembly.Memory allocations (and their ~10GB of
     * virtual address space each) on the next GC.
     *
     * Returns the list of plugin ids that were disposed, for logging.
     */
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

    /**
     * Dispose every instantiated plugin regardless of pinned state. Used
     * by the supervisor's pagehide shutdown path — the iframe is going
     * away, so pinning no longer matters. `compiledPlugin` references
     * are preserved on each Plugin, so bfcache restore can re-instantiate
     * without re-fetching or re-compiling.
     */
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

    /**
     * Sum core-module instance counts and WebAssembly.Memory counts across
     * currently-instantiated plugins. A single plugin is a component that
     * decomposes into multiple core module instances (primary + adapters
     * + trampolines), so these numbers are always >= the plugin count.
     */
    public countInstantiated(): {
        plugins: number;
        cores: number;
        memories: number;
    } {
        let plugins = 0;
        let cores = 0;
        let memories = 0;
        this.forEachPlugin((p) => {
            if (!p.isInstantiated) return;
            plugins++;
            cores += p.stats.coreCount ?? 0;
            memories += p.stats.memoryCount ?? 0;
        });
        return { plugins, cores, memories };
    }

    /**
     * Same shape as countInstantiated, but restricted to the given
     * service:plugin labels. Used to characterize the set of plugins
     * instantiated specifically for one entry() call.
     */
    public countByLabels(labels: Iterable<string>): {
        plugins: number;
        cores: number;
        memories: number;
    } {
        const set = new Set(labels);
        let plugins = 0;
        let cores = 0;
        let memories = 0;
        this.forEachPlugin((p) => {
            if (!set.has(pluginString(p.id))) return;
            plugins++;
            cores += p.stats.coreCount ?? 0;
            memories += p.stats.memoryCount ?? 0;
        });
        return { plugins, cores, memories };
    }

    /**
     * Walks every plugin, collecting fetch/compile timings for any that
     * have completed since the last call, and marks them as reported so
     * subsequent preloads only report newly-loaded plugins.
     */
    public collectPreloadStats(): {
        fetched: { label: string; ms: number; bytes: number }[];
        compiled: { label: string; ms: number }[];
    } {
        const fetched: { label: string; ms: number; bytes: number }[] = [];
        const compiled: { label: string; ms: number }[] = [];
        this.forEachPlugin((p) => {
            if (p.stats.reported) return;
            const label = pluginString(p.id);
            if (p.stats.fetchMs !== undefined && p.stats.fetchBytes !== undefined) {
                fetched.push({
                    label,
                    ms: p.stats.fetchMs,
                    bytes: p.stats.fetchBytes,
                });
            }
            if (p.stats.compileMs !== undefined) {
                compiled.push({ label, ms: p.stats.compileMs });
                // Only mark reported once compile has also completed —
                // otherwise a mid-cycle report could skip the compile line
                // on the next pass.
                p.stats.reported = true;
            }
        });
        return { fetched, compiled };
    }
}
