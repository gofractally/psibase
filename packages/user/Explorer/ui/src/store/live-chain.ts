import type {
    BlockHeader,
    BlockRecord,
    TransactionRecord,
    TransactionWithContext,
} from "@/lib/types";

import { parseChainTime } from "@/lib/format";
import { fetchBlocks } from "@/lib/queries";

export type LiveStatus = "connecting" | "live" | "stalled" | "error";

export interface BlockPoint {
    blockNum: number;
    time: number;
    txs: number;
    actions: number;
    userTxs: number;
    userActions: number;
    interval: number | null;
    producer: string;
}

export interface ProducerStats {
    name: string;
    blocks: number;
    lastBlockNum: number;
    lastBlockTime: number;
    share: number;
}

export interface ThroughputStats {
    txCount: number;
    actionCount: number;
    tps: number;
    txPerMinute: number;
    actionsPerMinute: number;
    /** `null` when no block in the window carried a counted transaction. */
    busiestBlock: BlockPoint | null;
}

export interface ChainStats {
    windowBlocks: number;
    windowSeconds: number;
    avgInterval: number;
    medianInterval: number;
    maxInterval: number;
    throughput: {
        all: ThroughputStats;
        /** Excludes system transactions. */
        user: ThroughputStats;
    };
    producers: ProducerStats[];
    serviceActivity: { service: string; count: number }[];
    series: BlockPoint[];
    commitLag: number;
    term: number;
}

export interface LiveChainState {
    blocks: BlockRecord[];
    head: BlockHeader | null;
    status: LiveStatus;
    error: string | null;
    lastBlockAt: number;
    lastPollAt: number;
    seeded: boolean;
    version: number;
    stats: ChainStats;
    recentTransactions: TransactionWithContext[];
    /** Buffered separately so system transactions don't evict user ones. */
    recentUserTransactions: TransactionWithContext[];
}

const WINDOW = 720; // blocks kept in memory (~12 min at 1 block/s)
const SEED = 300;
const POLL_MS = 1000;
const HIDDEN_POLL_MS = 5000;
const STALL_MS = 6000;
const TX_HISTORY = 400;

/**
 * The only system transaction is the block-start transaction, which is always
 * first in the block. Its contents are redacted, so position is the only signal.
 */
export const isSystemTransaction = (index: number) => index === 0;

export const flattenTransactions = (
    block: BlockRecord,
): TransactionWithContext[] =>
    block.transactions.map((trx: TransactionRecord, index) => ({
        id: trx.id,
        blockNum: block.header.blockNum,
        blockId: block.id,
        blockTime: block.header.time,
        producer: block.header.producer,
        index,
        numActions: trx.numActions,
        transaction: trx.transaction,
        isSystem: isSystemTransaction(index),
    }));

export const countActions = (block: BlockRecord) =>
    block.transactions.reduce((n, trx) => n + trx.numActions, 0);

export const countUserTransactions = (block: BlockRecord) =>
    block.transactions.filter((_, i) => !isSystemTransaction(i)).length;

export const countUserActions = (block: BlockRecord) =>
    block.transactions.reduce(
        (n, trx, i) => (isSystemTransaction(i) ? n : n + trx.numActions),
        0,
    );

const median = (values: number[]) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
};

const emptyThroughput = (): ThroughputStats => ({
    txCount: 0,
    actionCount: 0,
    tps: 0,
    txPerMinute: 0,
    actionsPerMinute: 0,
    busiestBlock: null,
});

const emptyStats = (): ChainStats => ({
    windowBlocks: 0,
    windowSeconds: 0,
    avgInterval: 0,
    medianInterval: 0,
    maxInterval: 0,
    throughput: { all: emptyThroughput(), user: emptyThroughput() },
    producers: [],
    serviceActivity: [],
    series: [],
    commitLag: 0,
    term: 0,
});

const computeThroughput = (
    series: BlockPoint[],
    txsOf: (p: BlockPoint) => number,
    actionsOf: (p: BlockPoint) => number,
): ThroughputStats => {
    if (series.length === 0) return emptyThroughput();

    let txCount = 0;
    let actionCount = 0;
    let busiest: BlockPoint | null = null;
    for (const p of series) {
        txCount += txsOf(p);
        actionCount += actionsOf(p);
        if (txsOf(p) > (busiest ? txsOf(busiest) : 0)) busiest = p;
    }

    // Trailing 60 seconds
    const last = series[series.length - 1].time;
    const cutoff = last - 60_000;
    let recentTx = 0;
    let recentActions = 0;
    let recentSpan = 0;
    for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].time < cutoff) break;
        recentTx += txsOf(series[i]);
        recentActions += actionsOf(series[i]);
        recentSpan = last - series[i].time;
    }
    const spanSec = Math.max(1, recentSpan / 1000);

    return {
        txCount,
        actionCount,
        tps: recentTx / spanSec,
        txPerMinute: (recentTx / spanSec) * 60,
        actionsPerMinute: (recentActions / spanSec) * 60,
        busiestBlock: busiest,
    };
};

const computeStats = (blocks: BlockRecord[]): ChainStats => {
    if (blocks.length === 0) return emptyStats();

    const series: BlockPoint[] = [];
    const intervals: number[] = [];
    const producerMap = new Map<string, ProducerStats>();
    const serviceMap = new Map<string, number>();

    let prevTime: number | null = null;

    for (const block of blocks) {
        const time = parseChainTime(block.header.time).getTime();
        const interval =
            prevTime === null ? null : Math.max(0, (time - prevTime) / 1000);
        if (interval !== null) intervals.push(interval);
        prevTime = time;

        for (const { service, count } of block.actionsReceived) {
            serviceMap.set(service, (serviceMap.get(service) ?? 0) + count);
        }
        series.push({
            blockNum: block.header.blockNum,
            time,
            txs: block.transactions.length,
            actions: countActions(block),
            userTxs: countUserTransactions(block),
            userActions: countUserActions(block),
            interval,
            producer: block.header.producer,
        });

        const p = producerMap.get(block.header.producer) ?? {
            name: block.header.producer,
            blocks: 0,
            lastBlockNum: 0,
            lastBlockTime: 0,
            share: 0,
        };
        p.blocks++;
        p.lastBlockNum = block.header.blockNum;
        p.lastBlockTime = time;
        producerMap.set(block.header.producer, p);
    }

    const first = series[0].time;
    const last = series[series.length - 1].time;
    const windowSeconds = Math.max(1, (last - first) / 1000);
    const avgInterval =
        intervals.length > 0
            ? intervals.reduce((a, b) => a + b, 0) / intervals.length
            : 0;

    const producers = [...producerMap.values()]
        .map((p) => ({ ...p, share: p.blocks / blocks.length }))
        .sort((a, b) => b.blocks - a.blocks);

    const head = blocks[blocks.length - 1].header;

    return {
        windowBlocks: blocks.length,
        windowSeconds,
        avgInterval,
        medianInterval: median(intervals),
        maxInterval: intervals.length ? Math.max(...intervals) : 0,
        throughput: {
            all: computeThroughput(series, (p) => p.txs, (p) => p.actions),
            user: computeThroughput(series, (p) => p.userTxs, (p) => p.userActions),
        },
        producers,
        serviceActivity: [...serviceMap.entries()]
            .map(([service, count]) => ({ service, count }))
            .sort((a, b) => b.count - a.count),
        series,
        commitLag: head.blockNum - head.commitNum,
        term: head.term,
    };
};

type Listener = () => void;

const initialState = (): LiveChainState => ({
    blocks: [],
    head: null,
    status: "connecting",
    error: null,
    lastBlockAt: 0,
    lastPollAt: 0,
    seeded: false,
    version: 0,
    stats: emptyStats(),
    recentTransactions: [],
    recentUserTransactions: [],
});

class LiveChainStore {
    private state: LiveChainState = initialState();
    private listeners = new Set<Listener>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;
    private inFlight = false;
    private viewer: string | null | undefined = undefined;
    private generation = 0;

    getState = () => this.state;

    subscribe = (listener: Listener) => {
        this.listeners.add(listener);
        if (!this.running) this.start();
        return () => {
            this.listeners.delete(listener);
        };
    };

    /**
     * Which transactions are redacted depends on who is logged in, so the
     * window must be refetched when the logged-in user changes.
     */
    setViewer = (viewer: string | null) => {
        const previous = this.viewer;
        this.viewer = viewer;
        if (previous !== undefined && previous !== viewer) this.reset();
    };

    start() {
        if (this.running) return;
        this.running = true;
        document.addEventListener("visibilitychange", this.onVisibility);
        void this.tick();
    }

    stop() {
        this.running = false;
        document.removeEventListener("visibilitychange", this.onVisibility);
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    private reset() {
        this.generation++;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.inFlight = false;
        this.emit({ ...initialState(), version: this.state.version });
        if (this.running) void this.tick();
    }

    private onVisibility = () => {
        if (document.visibilityState === "visible") {
            if (this.timer) clearTimeout(this.timer);
            void this.tick();
        }
    };

    private emit(patch: Partial<LiveChainState>) {
        this.state = { ...this.state, ...patch, version: this.state.version + 1 };
        for (const l of this.listeners) l();
    }

    private schedule() {
        if (!this.running) return;
        if (this.timer) clearTimeout(this.timer);
        const delay =
            document.visibilityState === "hidden" ? HIDDEN_POLL_MS : POLL_MS;
        this.timer = setTimeout(() => void this.tick(), delay);
    }

    private async tick() {
        if (this.inFlight) return;
        this.inFlight = true;
        const generation = this.generation;
        try {
            await this.poll(generation);
        } catch (err) {
            if (generation === this.generation) {
                this.emit({
                    status: "error",
                    error: err instanceof Error ? err.message : String(err),
                    lastPollAt: Date.now(),
                });
            }
        }
        // A reset while this poll was in flight already started a new one
        if (generation !== this.generation) return;
        this.inFlight = false;
        this.schedule();
    }

    private async poll(generation: number) {
        const { blocks, seeded } = this.state;
        const lastNum = blocks.length
            ? blocks[blocks.length - 1].header.blockNum
            : null;
        const connection = await fetchBlocks(
            seeded && lastNum !== null
                ? { gt: lastNum, first: WINDOW }
                : { last: SEED },
        );
        if (generation !== this.generation) return;
        const incoming = connection.edges
            .map((e) => e.node)
            .filter((b) => lastNum === null || b.header.blockNum > lastNum);
        const now = Date.now();

        if (incoming.length > 0) {
            const merged = [...blocks, ...incoming].slice(-WINDOW);
            const newTxs = incoming.flatMap(flattenTransactions).reverse();
            const recentTransactions = [
                ...newTxs,
                ...this.state.recentTransactions,
            ].slice(0, TX_HISTORY);
            const recentUserTransactions = [
                ...newTxs.filter((t) => !t.isSystem),
                ...this.state.recentUserTransactions,
            ].slice(0, TX_HISTORY);
            this.emit({
                blocks: merged,
                head: merged[merged.length - 1].header,
                status: "live",
                error: null,
                lastBlockAt: now,
                lastPollAt: now,
                seeded: true,
                stats: computeStats(merged),
                recentTransactions,
                recentUserTransactions,
            });
        } else {
            const stalled =
                this.state.lastBlockAt > 0 &&
                now - this.state.lastBlockAt > STALL_MS;
            this.emit({
                status: stalled ? "stalled" : seeded ? "live" : "connecting",
                error: null,
                lastPollAt: now,
                seeded: true,
            });
        }
    }
}

export const liveChain = new LiveChainStore();
