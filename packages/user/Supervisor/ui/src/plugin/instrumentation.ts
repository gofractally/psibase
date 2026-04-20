import { pluginString } from "@psibase/common-lib";

import { Plugins } from "./plugins";

/**
 * Instrumentation hub for the WASM-memory tuning effort.
 *
 * All timing capture, per-call counters, and console reporting (`[preload]`,
 * `[entry]`, `[gc]`) for plugin lifecycle live here. Operational code in
 * Supervisor / Plugins / Plugin owns *what* happens; this class owns
 * *measuring and reporting* what happened.
 *
 * Concurrent entry() calls are tolerated: each entryStart() returns an
 * opaque handle, and entryEnd() only emits when the handle still owns the
 * "current entry" pointer. Late onCall() hits during a stolen entry get
 * attributed to whoever owns the pointer at the time, matching the previous
 * inline behavior.
 *
 * REMOVAL CHECKLIST — when confidence in the new memory model is sufficient
 * and we want this telemetry gone, delete in this order:
 *   1. Delete this file (plugin/instrumentation.ts).
 *   2. supervisor.ts:
 *      - delete the `inst` field and its construction
 *      - delete every `this.inst.*(...)` call in preload, doPreload,
 *        entry, getJson, preloadPlugins, call, callResource
 *      - delete the local timing handles in entry() (inst handle)
 *      - drop the `(c, m) => ...` callback passed to parser()
 *   3. plugin/plugin.ts:
 *      - delete `PluginStats` interface and `stats` field
 *      - delete the timing-capture lines in doFetchPlugin / doReady /
 *        ensureInstantiated (the `t0 = performance.now()` and the
 *        `this.stats.X = ...` assignments)
 *      - delete the `gcQueue` / `flushGcQueue` / `gcRegistry` block and
 *        the gcRegistry?.register() call inside ensureInstantiated
 *   4. utils.ts:
 *      - drop the optional callback param on parser()
 *   5. plugin/plugins.ts:
 *      - if no other consumer remains, delete `forEachPlugin` and
 *        `listInstantiated`
 *
 * Operational concerns (the dispose-on-finally lifecycle, the Memory
 * model docblock at the top of plugin/plugin.ts) are NOT instrumentation
 * and stay.
 */

export interface EntryHandle {
    readonly _brand: unique symbol;
}

export class Instrumentation {
    constructor(private plugins: Plugins) {}

    private parserCoreCount = 0;
    private parserMemoryCount = 0;

    // Sentinel object identifying the entry that currently owns the
    // shared "in-flight entry" state. A second entryStart() replaces it;
    // the displaced entry's entryEnd() will see the mismatch and bow out
    // of report emission.
    private currentEntry: object | null = null;

    private entryLabel = "";
    private entryT0 = 0;
    private preloadMs = 0;
    private instMs = 0;
    private callCount = 0;
    private perPluginCalls: Map<string, number> = new Map();
    private preInst: Set<string> = new Set();
    private instantiatedThisCall: string[] = [];

    onParserLoaded(coreCount: number, memoryCount: number): void {
        this.parserCoreCount = coreCount;
        this.parserMemoryCount = memoryCount;
    }

    // ---- preload report (per doPreload invocation, regardless of caller) ----

    /** Returns a t0 to feed into preloadReportEnd. */
    preloadReportStart(): number {
        return performance.now();
    }

    /** Emits the `[preload]` line if anything new fetched/compiled.
     *  `reason` identifies the originating call so interleaved preloads are
     *  attributable (e.g. `entry:accounts:plugin api.getCurrentUser`,
     *  `preloadPlugins:[…]`, `getJson:foo:plugin`). */
    preloadReportEnd(t0: number, reason: string): void {
        const wallMs = performance.now() - t0;
        const { fetched, compiled } = this.collectPreloadStats();
        if (fetched.length === 0 && compiled.length === 0) return;

        const fmtKB = (b: number) => `${(b / 1024).toFixed(1)}KB`;
        const fmtMB = (b: number) => `${(b / 1024 / 1024).toFixed(2)}MB`;

        const totalBytes = fetched.reduce((s, f) => s + f.bytes, 0);
        const fetchSumMs = fetched.reduce((s, f) => s + f.ms, 0);
        const compileSumMs = compiled.reduce((s, c) => s + c.ms, 0);

        const lines = [
            `[preload] reason=${reason} wall=${wallMs.toFixed(1)}ms ` +
                `fetched=${fetched.length}(${fmtMB(totalBytes)}, Σ${fetchSumMs.toFixed(1)}ms) ` +
                `compiled=${compiled.length}(Σ${compileSumMs.toFixed(1)}ms)`,
        ];
        if (fetched.length > 0) {
            lines.push(
                `    fetched ${fetched.length}: [${fetched
                    .map((f) => `${f.label}(${f.ms.toFixed(0)}ms, ${fmtKB(f.bytes)})`)
                    .join(", ")}]`,
            );
        }
        if (compiled.length > 0) {
            lines.push(
                `    compiled ${compiled.length}: [${compiled
                    .map((c) => `${c.label}(${c.ms.toFixed(0)}ms)`)
                    .join(", ")}]`,
            );
        }
        console.log(lines.join("\n"));
    }

    // ---- entry-scoped lifecycle ----

    entryStart(label: string): EntryHandle {
        const handle = {} as unknown as EntryHandle;
        this.currentEntry = handle as unknown as object;
        this.entryLabel = label;
        this.entryT0 = performance.now();
        this.preloadMs = 0;
        this.instMs = 0;
        this.callCount = 0;
        this.perPluginCalls = new Map();
        this.preInst = new Set();
        this.instantiatedThisCall = [];
        return handle;
    }

    /** Returns a t0 to feed into entryPreloadEnd. */
    entryPreloadStart(): number {
        return performance.now();
    }

    entryPreloadEnd(t0: number): void {
        this.preloadMs = performance.now() - t0;
    }

    /** Returns a t0 to feed into entryInstEnd. Snapshots which plugins are
     *  already live so the post-instantiation diff measures only what the
     *  bulk ensureAllInstantiated() step added. (preload's Phase 0 may have
     *  instantiated system plugins for its internal sync calls; those land
     *  in preInst here and are excluded from `instantiated`.) */
    entryInstStart(): number {
        this.preInst = new Set(this.plugins.listInstantiated());
        return performance.now();
    }

    entryInstEnd(t0: number): void {
        this.instMs = performance.now() - t0;
        this.instantiatedThisCall = this.plugins
            .listInstantiated()
            .filter((name) => !this.preInst.has(name));
    }

    onCall(service: string, plugin: string): void {
        if (this.currentEntry === null) return;
        this.callCount++;
        const key = `${service}:${plugin}`;
        this.perPluginCalls.set(
            key,
            (this.perPluginCalls.get(key) ?? 0) + 1,
        );
    }

    entryEnd(handle: EntryHandle, disposed: string[], error?: unknown): void {
        // If a concurrent entry replaced us, bow out of report emission.
        // The displaced entry's stats are intentionally discarded — matches
        // the prior behavior where late call() hits got misattributed.
        if ((this.currentEntry as unknown) !== handle) return;
        this.currentEntry = null;

        const totalMs = performance.now() - this.entryT0;
        const instCounts = this.countByLabels(this.instantiatedThisCall);
        const disposedCounts = this.countByLabels(disposed);

        // Anything still instantiated after dispose is a leak (or the
        // component-parser utility, counted separately below). The +1/+parser
        // counts cover the permanent component-parser utility module.
        const retained = this.countInstantiated();
        const retainedPlugins = retained.plugins + 1;
        const retainedCores = retained.cores + this.parserCoreCount;
        const retainedMemories = retained.memories + this.parserMemoryCount;

        const header =
            `[entry] ${this.entryLabel}` +
            (error !== undefined ? " FAILED" : "") +
            ` — total=${totalMs.toFixed(1)}ms ` +
            `preload=${this.preloadMs.toFixed(1)}ms ` +
            `inst=${this.instMs.toFixed(1)}ms ` +
            `calls=${this.callCount} across ${this.perPluginCalls.size} plugin(s)`;

        const lines: string[] = [header];
        if (error !== undefined) {
            const msg = error instanceof Error ? error.message : String(error);
            lines.push(`    error: ${msg}`);
        }
        lines.push(
            this.instantiatedThisCall.length > 0
                ? `    bulk-inst (${this.instantiatedThisCall.length}p / ${instCounts.cores}c / ${instCounts.memories}m): [${this.instantiatedThisCall.join(", ")}]`
                : `    bulk-inst: (none added — preload's Phase 0 already instantiated everything this entry needs)`,
            disposed.length > 0
                ? `    disposed-this-entry (${disposed.length}p / ${disposedCounts.cores}c / ${disposedCounts.memories}m): [${disposed.join(", ")}]`
                : `    disposed-this-entry: (none)`,
            `    retained-after-dispose: ${retainedPlugins}p / ${retainedCores}c / ${retainedMemories}m (parser)`,
        );
        console.log(lines.join("\n"));
    }

    // ---- private aggregation helpers (walk plugin.stats directly) ----

    private countByLabels(labels: Iterable<string>): {
        plugins: number;
        cores: number;
        memories: number;
    } {
        const set = new Set(labels);
        let plugins = 0;
        let cores = 0;
        let memories = 0;
        this.plugins.forEachPlugin((p) => {
            if (!set.has(pluginString(p.id))) return;
            plugins++;
            cores += p.stats.coreCount ?? 0;
            memories += p.stats.memoryCount ?? 0;
        });
        return { plugins, cores, memories };
    }

    private countInstantiated(): {
        plugins: number;
        cores: number;
        memories: number;
    } {
        let plugins = 0;
        let cores = 0;
        let memories = 0;
        this.plugins.forEachPlugin((p) => {
            if (!p.isInstantiated) return;
            plugins++;
            cores += p.stats.coreCount ?? 0;
            memories += p.stats.memoryCount ?? 0;
        });
        return { plugins, cores, memories };
    }

    private collectPreloadStats(): {
        fetched: { label: string; ms: number; bytes: number }[];
        compiled: { label: string; ms: number }[];
    } {
        const fetched: { label: string; ms: number; bytes: number }[] = [];
        const compiled: { label: string; ms: number }[] = [];
        this.plugins.forEachPlugin((p) => {
            if (p.stats.reported) return;
            const label = pluginString(p.id);
            if (
                p.stats.fetchMs !== undefined &&
                p.stats.fetchBytes !== undefined
            ) {
                fetched.push({
                    label,
                    ms: p.stats.fetchMs,
                    bytes: p.stats.fetchBytes,
                });
            }
            if (p.stats.compileMs !== undefined) {
                compiled.push({ label, ms: p.stats.compileMs });
                // Only mark reported once compile completes — otherwise a
                // mid-cycle report could skip the compile line on the
                // next pass.
                p.stats.reported = true;
            }
        });
        return { fetched, compiled };
    }
}
