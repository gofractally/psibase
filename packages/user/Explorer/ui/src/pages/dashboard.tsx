import { useQuery } from "@tanstack/react-query";
import {
    ArrowLeftRight,
    Boxes,
    Gauge,
    Layers,
    Radio,
    ShieldCheck,
    Timer,
} from "lucide-react";
import { Link } from "react-router-dom";

import {
    formatDuration,
    formatNumber,
    formatSeconds,
    pct,
} from "@/lib/format";
import { fetchNetworkName, fetchProducersInfo } from "@/lib/queries";
import { useLiveChain } from "@/store/use-live-chain";

import { AccountLink } from "@/components/account-link";
import { BlockStrip } from "@/components/block-strip";
import { BlocksTable } from "@/components/blocks-table";
import { BlockActivityChart } from "@/components/charts/block-activity-chart";
import { ServiceActivityChart } from "@/components/charts/service-activity-chart";
import { MethodChip } from "@/components/action-chips";
import { Panel } from "@/components/page-header";
import { ProducerRing } from "@/components/producer-ring";
import { StatCard } from "@/components/stat-card";
import { TransactionsTable } from "@/components/transactions-table";

import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const DashboardPage = () => {
    const state = useLiveChain();
    const { blocks, head, stats, recentUserTransactions, status } = state;

    const { data: producersInfo } = useQuery({
        queryKey: ["producers", "info"],
        queryFn: fetchProducersInfo,
        refetchInterval: 15_000,
    });
    const { data: networkName } = useQuery({
        queryKey: ["branding", "name"],
        queryFn: fetchNetworkName,
        staleTime: Infinity,
    });

    const producerNames = producersInfo?.producers.map((p) => p.name) ?? [];
    const latestBlocks = blocks.slice(-10).reverse();
    const latestTxs = recentUserTransactions.slice(0, 10);
    const intervals = stats.series
        .map((p) => p.interval)
        .filter((v): v is number => v !== null)
        .slice(-60);
    const txSpark = stats.series.slice(-60).map((p) => p.userTxs);
    const activeProducers = stats.producers.length;

    return (
        <div className="flex flex-col gap-4">
            <div className="grid-bg -mx-4 -mt-4 px-4 pt-6 pb-2 md:-mx-6 md:-mt-6 md:px-6">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <div className="text-muted-foreground text-[11px] font-medium tracking-[0.2em] uppercase">
                            {networkName || "psibase"} · live explorer
                        </div>
                        <h1 className="text-3xl font-semibold tracking-tight">
                            Chain overview
                        </h1>
                    </div>
                    <div className="text-muted-foreground text-xs">
                        Window: last {formatNumber(stats.windowBlocks)} blocks ·{" "}
                        {formatDuration(stats.windowSeconds)}
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <StatCard
                        label="Head block"
                        icon={Boxes}
                        accent="var(--chart-2)"
                        value={
                            head ? (
                                <Link
                                    to={`/blocks/${head.blockNum}`}
                                    key={head.blockNum}
                                    className="flash-value font-mono hover:underline"
                                >
                                    #{formatNumber(head.blockNum)}
                                </Link>
                            ) : (
                                <Skeleton className="h-7 w-24" />
                            )
                        }
                        sub={
                            head ? (
                                <>
                                    produced by{" "}
                                    <AccountLink
                                        name={head.producer}
                                        dot={false}
                                        mono={false}
                                        className="text-xs"
                                    />
                                </>
                            ) : (
                                status
                            )
                        }
                    />
                    <StatCard
                        label="Block time"
                        icon={Timer}
                        accent="var(--chart-3)"
                        value={formatSeconds(stats.avgInterval)}
                        sub={`median ${formatSeconds(stats.medianInterval)} · max ${formatSeconds(stats.maxInterval, 1)}`}
                        spark={intervals}
                    />
                    <StatCard
                        label="Transactions / min"
                        icon={ArrowLeftRight}
                        accent="var(--chart-1)"
                        value={stats.txPerMinute.toFixed(1)}
                        sub={`${stats.userTps.toFixed(2)} tx/s · ${formatNumber(stats.userTxCount)} user tx in window`}
                        spark={txSpark}
                    />
                    <StatCard
                        label="Actions / min"
                        icon={Layers}
                        accent="var(--chart-4)"
                        value={stats.actionsPerMinute.toFixed(1)}
                        sub={`${formatNumber(stats.actionCount)} actions across ${stats.serviceActivity.length} services`}
                    />
                    <StatCard
                        label="Producers"
                        icon={Radio}
                        accent="var(--chart-5)"
                        value={
                            producersInfo
                                ? producersInfo.producers.length
                                : activeProducers || "—"
                        }
                        sub={
                            producersInfo
                                ? `${producersInfo.mode} consensus · ${activeProducers} active in window`
                                : "loading consensus…"
                        }
                    />
                    <StatCard
                        label="Finality"
                        icon={ShieldCheck}
                        accent="var(--chart-2)"
                        value={
                            stats.commitLag === 0 ? (
                                <span className="text-emerald-500">Instant</span>
                            ) : (
                                `${stats.commitLag} blocks`
                            )
                        }
                        sub={`commit #${formatNumber(head?.commitNum ?? 0)} · term ${stats.term}`}
                    />
                </div>
            </div>

            <Panel
                title="Chain heartbeat"
                description="One cell per block, colored by producer; height shows transactions carried"
                actions={
                    <div className="text-muted-foreground flex items-center gap-3 text-[11px]">
                        {stats.producers.slice(0, 4).map((p) => (
                            <span key={p.name} className="inline-flex items-center gap-1">
                                <span
                                    className="size-2 rounded-sm"
                                    style={{ backgroundColor: `hsl(${hue(p.name)} 80% 60%)` }}
                                />
                                {p.name}
                            </span>
                        ))}
                    </div>
                }
                bodyClassName="px-4 py-3"
            >
                {stats.series.length ? (
                    <BlockStrip series={stats.series} count={120} />
                ) : (
                    <Skeleton className="h-14 w-full" />
                )}
            </Panel>

            <div className="grid gap-4 xl:grid-cols-3">
                <Panel
                    title="Activity"
                    description="Transactions per block (bars) and block interval (line)"
                    className="xl:col-span-2"
                    bodyClassName="px-2 pt-3 pb-1"
                >
                    {stats.series.length > 1 ? (
                        <BlockActivityChart series={stats.series.slice(-180)} height={260} />
                    ) : (
                        <Skeleton className="m-2 h-[240px]" />
                    )}
                </Panel>
                <Panel
                    title="Producer network"
                    description="Live view of who is producing"
                    actions={
                        <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                            <Link to="/producers">Details</Link>
                        </Button>
                    }
                    bodyClassName="flex items-center justify-center p-3"
                >
                    <ProducerRing
                        producers={producerNames}
                        stats={stats.producers}
                        head={head}
                        mode={producersInfo?.mode}
                        size={340}
                        className="w-full max-w-[340px]"
                    />
                </Panel>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                <Panel
                    title="Latest blocks"
                    actions={
                        <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                            <Link to="/blocks">View all</Link>
                        </Button>
                    }
                >
                    <BlocksTable blocks={latestBlocks} compact />
                </Panel>
                <Panel
                    title="Latest transactions"
                    description="System block-start transactions hidden"
                    actions={
                        <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                            <Link to="/transactions">View all</Link>
                        </Button>
                    }
                >
                    <TransactionsTable
                        transactions={latestTxs}
                        compact
                        emptyMessage="No user transactions in the recent window yet"
                    />
                </Panel>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
                <Panel title="Activity by service" description="User actions in window" bodyClassName="p-4">
                    <ServiceActivityChart data={stats.serviceActivity} height={180} />
                </Panel>
                <Panel title="Top methods" description="Most-called service methods" bodyClassName="p-2">
                    {stats.methodActivity.length === 0 ? (
                        <EmptyNote />
                    ) : (
                        <ul className="flex flex-col">
                            {stats.methodActivity.slice(0, 8).map((m) => (
                                <li
                                    key={m.key}
                                    className="hover:bg-accent/40 flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
                                >
                                    <MethodChip service={m.service} method={m.method} />
                                    <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                                        {formatNumber(m.count)}
                                        <span className="ml-1 opacity-60">
                                            {pct(m.count, stats.actionCount, 0)}
                                        </span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
                <Panel title="Most active accounts" description="By actions sent" bodyClassName="p-2">
                    {stats.senderActivity.length === 0 ? (
                        <EmptyNote />
                    ) : (
                        <ul className="flex flex-col">
                            {stats.senderActivity.slice(0, 8).map((s, i) => (
                                <li
                                    key={s.sender}
                                    className="hover:bg-accent/40 flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
                                >
                                    <span className="flex items-center gap-2">
                                        <span className="text-muted-foreground w-4 text-right font-mono text-[10px]">
                                            {i + 1}
                                        </span>
                                        <AccountLink name={s.sender} />
                                    </span>
                                    <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                                        {formatNumber(s.count)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
            </div>

            <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
                <Gauge className="size-3.5" />
                Statistics are computed client-side from the rolling window of recent blocks.
            </div>
        </div>
    );
};

const EmptyNote = () => (
    <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
        No user activity in the current window
    </div>
);

const hue = (label: string) => {
    let hash = 0;
    for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
    return Math.abs(hash) % 360;
};
