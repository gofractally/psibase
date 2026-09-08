import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Radio } from "lucide-react";
import { Link } from "react-router-dom";

import { colorFor } from "@/lib/colors";
import { formatNumber, pct } from "@/lib/format";
import {
    fetchAllCandidates,
    fetchCandidates,
    fetchProducersInfo,
} from "@/lib/queries";
import { useLiveChain, useNow } from "@/store/use-live-chain";

import { AccountLink } from "@/components/account-link";
import { BlockStrip } from "@/components/block-strip";
import { PageHeader, Panel } from "@/components/page-header";
import { ProducerRing } from "@/components/producer-ring";
import { StatCard } from "@/components/stat-card";
import { TimeAgo } from "@/components/time-ago";

import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const hostOf = (endpoint: string) => {
    try {
        return new URL(endpoint).host;
    } catch {
        return endpoint;
    }
};

export const ProducersPage = () => {
    const { head, stats } = useLiveChain();
    const now = useNow();

    const info = useQuery({
        queryKey: ["producers", "info"],
        queryFn: fetchProducersInfo,
        refetchInterval: 10_000,
    });

    const names = info.data?.producers.map((p) => p.name) ?? [];
    const nextNames = info.data?.nextProducers.map((p) => p.name) ?? [];
    const allNames = [...new Set([...names, ...nextNames, ...stats.producers.map((p) => p.name)])];

    const candidates = useQuery({
        queryKey: ["producers", "candidates", allNames.join(",")],
        queryFn: () => fetchCandidates(allNames),
        enabled: allNames.length > 0,
        staleTime: 60_000,
    });
    const allCandidates = useQuery({
        queryKey: ["producers", "all-candidates"],
        queryFn: fetchAllCandidates,
        staleTime: 60_000,
    });

    const endpointFor = (name: string) =>
        candidates.data?.find((c) => c.account === name)?.endpoint ?? "";
    const statFor = (name: string) => stats.producers.find((p) => p.name === name);
    const authFor = (name: string) =>
        info.data?.producers.find((p) => p.name === name)?.auth?.service ?? "";

    const mode = info.data?.mode ?? "…";
    const quorum =
        info.data && names.length > 0
            ? info.data.mode === "BFT"
                ? Math.floor((2 * names.length) / 3) + 1
                : Math.floor(names.length / 2) + 1
            : null;

    const rows = allNames.map((name) => {
        const s = statFor(name);
        const inSet = names.includes(name);
        const idleMs = s ? now - s.lastBlockTime : Infinity;
        const status = !inSet
            ? "retired"
            : !s
              ? "waiting"
              : idleMs < Math.max(5000, stats.avgInterval * 1000 * names.length * 2)
                ? "active"
                : "idle";
        return { name, s, inSet, status };
    });

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title={
                    <span className="flex items-center gap-3">
                        Block producers
                        {info.data && (
                            <Badge variant="outline" className="font-mono">
                                {mode}
                            </Badge>
                        )}
                    </span>
                }
                description={
                    info.data
                        ? `${names.length} producer${names.length === 1 ? "" : "s"} in the active set${
                              quorum ? ` · quorum ${quorum}` : ""
                          }${info.data.nextMode ? ` · transition to ${info.data.nextMode} pending` : ""}`
                        : "Loading consensus configuration…"
                }
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                    label="Consensus"
                    icon={Radio}
                    accent="var(--chart-5)"
                    value={mode}
                    sub={
                        mode === "BFT"
                            ? "Byzantine fault tolerant"
                            : mode === "CFT"
                              ? "Crash fault tolerant"
                              : "—"
                    }
                />
                <StatCard
                    label="Active set"
                    accent="var(--chart-2)"
                    value={names.length || "—"}
                    sub={`${stats.producers.length} produced in window`}
                />
                <StatCard
                    label="Current term"
                    accent="var(--chart-3)"
                    value={head?.term ?? "—"}
                    sub={head ? `leader ${head.producer}` : ""}
                />
                <StatCard
                    label="Commit lag"
                    accent="var(--chart-1)"
                    value={stats.commitLag === 0 ? "0" : `${stats.commitLag}`}
                    sub={head ? `commit #${formatNumber(head.commitNum)}` : ""}
                />
            </div>

            <div className="grid gap-4 xl:grid-cols-5">
                <Panel
                    title="Network"
                    description="Nodes flash and send a pulse to the head each time they produce"
                    className="xl:col-span-2"
                    bodyClassName="flex items-center justify-center p-4"
                >
                    <ProducerRing
                        producers={names}
                        stats={stats.producers}
                        head={head}
                        mode={info.data?.mode}
                        size={420}
                        className="w-full max-w-[460px]"
                    />
                </Panel>

                <Panel title="Producer set" className="xl:col-span-3">
                    {info.isPending ? (
                        <div className="flex flex-col gap-2 p-4">
                            <Skeleton className="h-8" />
                            <Skeleton className="h-8" />
                        </div>
                    ) : (
                        <div className="scrollbar-thin overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <thead className="bg-muted/30 border-b">
                                    <tr className="text-muted-foreground text-left text-[11px] tracking-wider uppercase">
                                        <th className="h-8 px-3 font-medium">Producer</th>
                                        <th className="h-8 px-3 font-medium">Status</th>
                                        <th className="h-8 px-3 font-medium">Endpoint</th>
                                        <th className="h-8 px-3 text-right font-medium">Blocks</th>
                                        <th className="h-8 px-3 text-right font-medium">Share</th>
                                        <th className="h-8 px-3 font-medium">Last block</th>
                                        <th className="h-8 px-3 font-medium">Auth</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(({ name, s, status }) => (
                                        <tr key={name} className="hover:bg-accent/40 border-b last:border-b-0">
                                            <td className="px-3 py-2">
                                                <span className="flex items-center gap-2">
                                                    <span
                                                        className="flex size-7 items-center justify-center rounded-full font-mono text-[10px] font-semibold text-white"
                                                        style={{ backgroundColor: colorFor(name) }}
                                                    >
                                                        {name.slice(0, 2).toUpperCase()}
                                                    </span>
                                                    <AccountLink name={name} dot={false} />
                                                </span>
                                            </td>
                                            <td className="px-3 py-2">
                                                <span
                                                    className={cn(
                                                        "inline-flex items-center gap-1.5 text-xs",
                                                        status === "active" && "text-emerald-500",
                                                        status === "idle" && "text-amber-500",
                                                        status === "waiting" && "text-muted-foreground",
                                                        status === "retired" && "text-muted-foreground line-through",
                                                    )}
                                                >
                                                    <span
                                                        className={cn(
                                                            "size-1.5 rounded-full",
                                                            status === "active" && "bg-emerald-500",
                                                            status === "idle" && "bg-amber-500",
                                                            (status === "waiting" || status === "retired") && "bg-muted-foreground",
                                                        )}
                                                    />
                                                    {status}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 font-mono text-xs">
                                                {endpointFor(name) ? (
                                                    <a
                                                        href={endpointFor(name)}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="hover:text-primary inline-flex items-center gap-1 hover:underline"
                                                    >
                                                        {hostOf(endpointFor(name))}
                                                        <ExternalLink className="size-3 opacity-60" />
                                                    </a>
                                                ) : (
                                                    <span className="text-muted-foreground">not published</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                                                {s ? formatNumber(s.blocks) : "0"}
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                <span className="inline-flex items-center gap-2">
                                                    <span className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
                                                        <span
                                                            className="block h-full rounded-full"
                                                            style={{
                                                                width: `${(s?.share ?? 0) * 100}%`,
                                                                backgroundColor: colorFor(name),
                                                            }}
                                                        />
                                                    </span>
                                                    <span className="w-12 text-right font-mono text-xs tabular-nums">
                                                        {s ? pct(s.blocks, stats.windowBlocks) : "0%"}
                                                    </span>
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-xs">
                                                {s ? (
                                                    <span className="flex items-center gap-2">
                                                        <Link to={`/blocks/${s.lastBlockNum}`} className="text-primary font-mono hover:underline">
                                                            #{formatNumber(s.lastBlockNum)}
                                                        </Link>
                                                        <span className="text-muted-foreground">
                                                            <TimeAgo time={s.lastBlockTime} />
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 font-mono text-xs">
                                                {authFor(name) ? (
                                                    <AccountLink name={authFor(name)} dot={false} />
                                                ) : (
                                                    <span className="text-muted-foreground">none</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Panel>
            </div>

            {info.data?.nextConsensus && (
                <Panel
                    title="Pending consensus change"
                    description={
                        info.data.jointStart
                            ? `Joint consensus started at block #${formatNumber(info.data.jointStart)}`
                            : "A new producer set has been scheduled"
                    }
                    bodyClassName="flex flex-wrap items-center gap-2 p-4"
                >
                    <Badge variant="outline" className="font-mono">
                        {info.data.nextMode}
                    </Badge>
                    {nextNames.map((n) => (
                        <AccountLink key={n} name={n} />
                    ))}
                </Panel>
            )}

            <Panel
                title="Production timeline"
                description="Most recent blocks, colored by producer"
                bodyClassName="px-4 py-3"
            >
                {stats.series.length ? (
                    <BlockStrip series={stats.series} count={160} />
                ) : (
                    <Skeleton className="h-14 w-full" />
                )}
            </Panel>

            <Panel
                title="Registered candidates"
                description="Accounts that have published a producer endpoint"
                bodyClassName="p-2"
            >
                {allCandidates.isPending ? (
                    <Skeleton className="m-2 h-8" />
                ) : !allCandidates.data?.length ? (
                    <div className="text-muted-foreground p-4 text-sm">
                        No producer candidates have registered an endpoint.
                    </div>
                ) : (
                    <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                        {allCandidates.data.map((c) => (
                            <li key={c.account} className="hover:bg-accent/40 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs">
                                <AccountLink name={c.account} />
                                <span className="text-muted-foreground truncate font-mono">
                                    {hostOf(c.endpoint)}
                                </span>
                                {names.includes(c.account) && (
                                    <Badge variant="outline" className="h-4 px-1 text-[9px]">
                                        active
                                    </Badge>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Panel>
        </div>
    );
};
