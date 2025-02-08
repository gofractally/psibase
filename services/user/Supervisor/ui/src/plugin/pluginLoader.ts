import { isEqual, QualifiedPluginId } from "@psibase/common-lib";
import { Plugins } from "./plugins";

class PluginIdSet {
    private items: Set<string> = new Set<string>();

    add(item: QualifiedPluginId): void {
        const key = JSON.stringify(item);
        this.items.add(key);
    }

    has(item: QualifiedPluginId): boolean {
        const key = JSON.stringify(item);
        return this.items.has(key);
    }

    delete(item: QualifiedPluginId): boolean {
        const key = JSON.stringify(item);
        return this.items.delete(key);
    }

    clear(): void {
        this.items.clear();
    }

    values(): QualifiedPluginId[] {
        return Array.from(this.items).map((item) => JSON.parse(item));
    }

    size(): number {
        return this.items.size;
    }
}
export class PluginLoader {
    private plugins: Plugins;
    private allLoadedPlugins: PluginIdSet = new PluginIdSet();
    private currentPlugins: QualifiedPluginId[] = [];

    private reset() {
        this.allLoadedPlugins.clear();
        this.currentPlugins = [];
    }

    private async getAllDependencies(): Promise<QualifiedPluginId[]> {
        if (this.currentPlugins.length === 0) {
            return [];
        }

        const imports = await Promise.all(
            this.currentPlugins.map(async (pluginId) => {
                // Download and parse the plugin, read its imports to determine dependencies
                const p = this.plugins.getPlugin(pluginId).plugin;
                return await p.getDependencies();
            }),
        );

        // Flatten and deduplicate
        let dependencies = imports
            .flat()
            .reduce((acc: QualifiedPluginId[], current: QualifiedPluginId) => {
                if (!acc.some((obj) => isEqual(obj, current))) {
                    acc.push(current);
                }
                return acc;
            }, []);

        return dependencies;
    }

    private removeHostPlugins() {
        // Plugins at these namespace are built into the supervisor host itself and
        //  are not pulled from the chain.
        this.currentPlugins = this.currentPlugins.filter(
            (id) => id.service !== "wasi" && id.service !== "host",
        );
    }

    private removeAlreadyAddedPlugins() {
        this.currentPlugins = this.currentPlugins.filter(
            (plugin) => !this.allLoadedPlugins.has(plugin),
        );
    }

    constructor(plugins: Plugins) {
        this.plugins = plugins;
    }

    public trackPlugins(plugins: QualifiedPluginId[]) {
        this.reset();
        this.currentPlugins = plugins;
    }

    public async processPlugins() {
        while (this.currentPlugins.length > 0) {
            // Prune the currentPlugins list
            this.removeHostPlugins();
            this.removeAlreadyAddedPlugins();

            // Load the plugins
            for (const p of this.currentPlugins) {
                this.plugins.getPlugin(p);
                this.allLoadedPlugins.add(p);
            }

            // Prepare to load all dependencies
            this.currentPlugins = await this.getAllDependencies();
        }
    }

    public async awaitReady() {
        await Promise.all(
            this.allLoadedPlugins
                .values()
                .map((p) => this.plugins.getPlugin(p).plugin.ready),
        );
    }
}
