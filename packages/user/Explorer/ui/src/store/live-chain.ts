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
    userTxs: number;
    actions: number;
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

export interface ChainStats {
    windowBlocks: number;
    windowSeconds: number;
    avgInterval: number;
    medianInterval: number;
    maxInterval: number;
    txCount: number;
    userTxCount: number;
    actionCount: number;
    userTps: number;
    txPerMinute: number;
    systemTxPerMinute: number;
    actionsPerMinute: number;
    producers: ProducerStats[];
    serviceActivity: { service: string; count: number }[];
    methodActivity: { key: string; service: string; method: string; count: number }[];
    senderActivity: { sender: string; count: number }[];
    series: BlockPoint[];
    commitLag: number;
    term: number;
    busiestBlock: BlockPoint | null;
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
    recentUserTransactions: TransactionWithContext[];
}

const WINDOW = 720; // blocks kept in memory (~12 min at 1 block/s)
const SEED = 300;
const POLL_MS = 1000;
const HIDDEN_POLL_MS = 5000;
const STALL_MS = 6000;
const TX_HISTORY = 400;

export const isSystemTransaction = (trx: TransactionRecord) =>
    trx.transaction.actions.length > 0 &&
    trx.transaction.actions.every((a) => a.sender === "");

export const flattenTransactions = (
    block: BlockRecord,
): TransactionWithContext[] =>
    block.transactions.map((trx, index) => ({
        id: trx.id,
        blockNum: block.header.blockNum,
        blockId: block.id,
        blockTime: block.header.time,
        producer: block.header.producer,
        index,
        transaction: trx.transaction,
        isSystem: isSystemTransaction(trx),
    }));

const median = (values: number[]) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
};

const emptyStats = (): ChainStats => ({
    windowBlocks: 0,
    windowSeconds: 0,
    avgInterval: 0,
    medianInterval: 0,
    maxInterval: 0,
    txCount: 0,
    userTxCount: 0,
    actionCount: 0,
    userTps: 0,
    txPerMinute: 0,
    systemTxPerMinute: 0,
    actionsPerMinute: 0,
    producers: [],
    serviceActivity: [],
    methodActivity: [],
    senderActivity: [],
    series: [],
    commitLag: 0,
    term: 0,
    busiestBlock: null,
});

const computeStats = (blocks: BlockRecord[]): ChainStats => {
    if (blocks.length === 0) return emptyStats();

    const series: BlockPoint[] = [];
    const intervals: number[] = [];
    const producerMap = new Map<string, ProducerStats>();
    const serviceMap = new Map<string, number>();
    const methodMap = new Map<string, number>();
    const senderMap = new Map<string, number>();

    let txCount = 0;
    let userTxCount = 0;
    let actionCount = 0;
    let prevTime: number | null = null;
    let busiest: BlockPoint | null = null;

    for (const block of blocks) {
        const time = parseChainTime(block.header.time).getTime();
        const interval =
            prevTime === null ? null : Math.max(0, (time - prevTime) / 1000);
        if (interval !== null) intervals.push(interval);
        prevTime = time;

        let userTxs = 0;
        let actions = 0;
        for (const trx of block.transactions) {
            const system = isSystemTransaction(trx);
            if (!system) userTxs++;
            for (const action of trx.transaction.actions) {
                if (system) continue;
                actions++;
                serviceMap.set(
                    action.service,
                    (serviceMap.get(action.service) ?? 0) + 1,
                );
                const key = `${action.service}::${action.method}`;
                methodMap.set(key, (methodMap.get(key) ?? 0) + 1);
                if (action.sender) {
                    senderMap.set(
                        action.sender,
                        (senderMap.get(action.sender) ?? 0) + 1,
                    );
                }
            }
        }
        txCount += block.transactions.length;
        userTxCount += userTxs;
        actionCount += actions;

        const point: BlockPoint = {
            blockNum: block.header.blockNum,
            time,
            txs: block.transactions.length,
            userTxs,
            actions,
            interval,
            producer: block.header.producer,
        };
        series.push(point);
        if (!busiest || point.userTxs > busiest.userTxs) busiest = point;

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

    // Throughput over the trailing 60 seconds
    const cutoff = last - 60_000;
    let recentUserTx = 0;
    let recentTx = 0;
    let recentActions = 0;
    let recentSpan = 0;
    for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].time < cutoff) break;
        recentUserTx += series[i].userTxs;
        recentTx += series[i].txs;
        recentActions += series[i].actions;
        recentSpan = last - series[i].time;
    }
    const spanSec = Math.max(1, recentSpan / 1000);

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
        txCount,
        userTxCount,
        actionCount,
        userTps: recentUserTx / spanSec,
        txPerMinute: (recentUserTx / spanSec) * 60,
        systemTxPerMinute: ((recentTx - recentUserTx) / spanSec) * 60,
        actionsPerMinute: (recentActions / spanSec) * 60,
        producers,
        serviceActivity: [...serviceMap.entries()]
            .map(([service, count]) => ({ service, count }))
            .sort((a, b) => b.count - a.count),
        methodActivity: [...methodMap.entries()]
            .map(([key, count]) => {
                const [service, method] = key.split("::");
                return { key, service, method, count };
            })
            .sort((a, b) => b.count - a.count),
        senderActivity: [...senderMap.entries()]
            .map(([sender, count]) => ({ sender, count }))
            .sort((a, b) => b.count - a.count),
        series,
        commitLag: head.blockNum - head.commitNum,
        term: head.term,
        busiestBlock: busiest,
    };
};

type Listener = () => void;

class LiveChainStore {
    private state: LiveChainState = {
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
    };
    private listeners = new Set<Listener>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;
    private inFlight = false;
    private controller: AbortController | null = null;

    getState = () => this.state;

    subscribe = (listener: Listener) => {
        this.listeners.add(listener);
        if (!this.running) this.start();
        return () => {
            this.listeners.delete(listener);
        };
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
        this.controller?.abort();
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
        this.controller = new AbortController();
        try {
            const { blocks, seeded } = this.state;
            const lastNum = blocks.length
                ? blocks[blocks.length - 1].header.blockNum
                : null;
            const connection = await fetchBlocks(
                seeded && lastNum !== null
                    ? { gt: lastNum, first: WINDOW }
                    : { last: SEED },
                this.controller.signal,
            );
            const incoming = connection.edges
                .map((e) => e.node)
                .filter(
                    (b) => lastNum === null || b.header.blockNum > lastNum,
                );
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
        } catch (err) {
            if (!(err instanceof DOMException && err.name === "AbortError")) {
                this.emit({
                    status: "error",
                    error: err instanceof Error ? err.message : String(err),
                    lastPollAt: Date.now(),
                });
            }
        } finally {
            this.inFlight = false;
            this.controller = null;
            this.schedule();
        }
    }
}

export const liveChain = new LiveChainStore();
