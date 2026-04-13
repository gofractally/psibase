import { pluginString, QualifiedPluginId } from "@psibase/common-lib";

import { Plugin } from "./plugin";

interface PoolEntry {
    plugin: Plugin;
    lastUsed: number;
}

/**
 * Manages the lifecycle of instantiated plugins to keep the number of
 * concurrent WebAssembly instances within a budget. Plugins are tracked
 * by the pool when instantiated and evicted (disposed) via LRU when
 * the budget is exceeded.
 *
 * System plugins can be pinned — they are never evicted.
 */
export class InstancePool {
    private budget: number;
    private entries = new Map<string, PoolEntry>();
    private pinned = new Set<string>();
    private totalInstantiations = 0;
    private totalEvictions = 0;

    constructor(budget: number = 24) {
        this.budget = budget;
    }

    private key(id: QualifiedPluginId): string {
        return pluginString(id);
    }

    register(plugin: Plugin, isPinned: boolean = false): void {
        const k = this.key(plugin.id);
        if (this.entries.has(k)) return;
        this.entries.set(k, { plugin, lastUsed: Date.now() });
        this.totalInstantiations++;
        if (isPinned) {
            this.pinned.add(k);
        }
    }

    unregister(plugin: Plugin): void {
        const k = this.key(plugin.id);
        this.entries.delete(k);
        this.pinned.delete(k);
    }

    touch(plugin: Plugin): void {
        const entry = this.entries.get(this.key(plugin.id));
        if (entry) {
            entry.lastUsed = Date.now();
        }
    }

    /**
     * Evict least-recently-used non-pinned plugins until the pool is at
     * or below budget. Returns the number of plugins evicted.
     */
    evictIdle(): number {
        let evicted = 0;
        while (this.entries.size > this.budget) {
            let oldest: { key: string; time: number } | null = null;
            for (const [key, entry] of this.entries) {
                if (this.pinned.has(key)) continue;
                if (!oldest || entry.lastUsed < oldest.time) {
                    oldest = { key, time: entry.lastUsed };
                }
            }
            if (!oldest) break;

            const entry = this.entries.get(oldest.key)!;
            console.log(`[pool] evict ${oldest.key}`);
            entry.plugin.dispose();
            this.entries.delete(oldest.key);
            evicted++;
            this.totalEvictions++;
        }
        return evicted;
    }

    get size(): number {
        return this.entries.size;
    }

    get pinnedCount(): number {
        return this.pinned.size;
    }

    summary(): string {
        return `live=${this.entries.size} pinned=${this.pinned.size} budget=${this.budget} total_instantiations=${this.totalInstantiations} total_evictions=${this.totalEvictions}`;
    }
}
