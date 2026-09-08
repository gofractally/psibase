import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { siblingUrl } from "@psibase/common-lib";

import {
    formatDuration,
    formatNumber,
    formatSeconds,
    formatTime,
    parseChainTime,
} from "@/lib/format";
import {
    fetchBlockHeader,
    fetchChainId,
    fetchInstalledPackages,
    fetchNetworkName,
    fetchProducersInfo,
    fetchRootDomain,
    fetchSnapshotInfo,
} from "@/lib/queries";
import { FIRST_VISIBLE_BLOCK } from "@/lib/types";
import { useLiveChain, useNow } from "@/store/use-live-chain";

import { AccountLink } from "@/components/account-link";
import { Hash } from "@/components/hash";
import { StatusDot } from "@/components/live-indicator";
import { KeyValue, PageHeader, Panel } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { TimeAgo } from "@/components/time-ago";

import { Badge } from "@shared/shadcn/ui/badge";

const API_SERVICES = [
    { name: "explorer", note: "blocks, block(n), head, transaction(id)" },
    { name: "producers", note: "producers, consensus, candidates" },
    { name: "accounts", note: "getAccount" },
    { name: "auth-sig", note: "account keys, accWithKey" },
    { name: "packages", note: "installed packages" },
    { name: "setcode", note: "service code records" },
    { name: "registry", note: "app metadata" },
    { name: "transact", note: "snapshotInfo" },
];

export const NetworkPage = () => {
    const { head, stats, status, lastPollAt, error } = useLiveChain();
    const now = useNow();

    const networkName = useQuery({ queryKey: ["branding", "name"], queryFn: fetchNetworkName, staleTime: Infinity });
    const chainId = useQuery({ queryKey: ["chain", "id"], queryFn: fetchChainId, staleTime: Infinity });
    const rootDomain = useQuery({ queryKey: ["chain", "root"], queryFn: fetchRootDomain, staleTime: Infinity });
    const producers = useQuery({ queryKey: ["producers", "info"], queryFn: fetchProducersInfo, refetchInterval: 15_000 });
    const snapshot = useQuery({ queryKey: ["transact", "snapshot"], queryFn: fetchSnapshotInfo, staleTime: 60_000 });
    const packages = useQuery({ queryKey: ["packages", "installed"], queryFn: fetchInstalledPackages, staleTime: 5 * 60_000 });
    const firstBlock = useQuery({
        queryKey: ["block", FIRST_VISIBLE_BLOCK, "header"],
        queryFn: () => fetchBlockHeader(FIRST_VISIBLE_BLOCK),
        staleTime: Infinity,
    });

    const genesisTime = firstBlock.data ? parseChainTime(firstBlock.data.time).getTime() : null;
    const chainAge = genesisTime ? (now - genesisTime) / 1000 : null;
    const totalBlocks = head ? head.blockNum - FIRST_VISIBLE_BLOCK + 1 : null;
    const blocksPerDay = stats.avgInterval > 0 ? Math.round(86400 / stats.avgInterval) : null;

    // Block interval histogram
    const buckets = new Map<string, number>();
    for (const p of stats.series) {
        if (p.interval === null) continue;
        const key =
            p.interval < 0.75 ? "<0.75" :
            p.interval < 1.25 ? "1s" :
            p.interval < 1.75 ? "1.5s" :
            p.interval < 2.5 ? "2s" :
            p.interval < 5 ? "2–5s" : ">5s";
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const order = ["<0.75", "1s", "1.5s", "2s", "2–5s", ">5s"];
    const histogram = order.filter((k) => buckets.has(k)).map((k) => ({ bucket: k, count: buckets.get(k)! }));

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title={networkName.data ? `Network: ${networkName.data}` : "Network"}
                description="Chain identity, consensus configuration, and health"
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                    label="Chain age"
                    accent="var(--chart-2)"
                    value={chainAge !== null ? formatDuration(chainAge) : "—"}
                    sub={firstBlock.data ? `since ${formatTime(firstBlock.data.time)}` : "loading…"}
                />
                <StatCard
                    label="Blocks"
                    accent="var(--chart-3)"
                    value={totalBlocks !== null ? formatNumber(totalBlocks) : "—"}
                    sub={blocksPerDay ? `≈ ${formatNumber(blocksPerDay)} per day at current pace` : ""}
                />
                <StatCard
                    label="Block interval"
                    accent="var(--chart-1)"
                    value={formatSeconds(stats.avgInterval)}
                    sub={`p50 ${formatSeconds(stats.medianInterval)} · max ${formatSeconds(stats.maxInterval, 1)}`}
                />
                <StatCard
                    label="Explorer feed"
                    accent={status === "live" ? "var(--chart-2)" : "var(--destructive)"}
                    value={
                        <span className="flex items-center gap-2 capitalize">
                            <StatusDot /> {status}
                        </span>
                    }
                    sub={lastPollAt ? <>polled <TimeAgo time={lastPollAt} tooltip={false} /></> : "…"}
                />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                <Panel title="Identity">
                    <KeyValue label="Network name">{networkName.data || <span className="text-muted-foreground">unset</span>}</KeyValue>
                    <KeyValue label="Chain ID">
                        {chainId.data ? <Hash value={chainId.data} full /> : <span className="text-muted-foreground text-xs">unavailable</span>}
                    </KeyValue>
                    <KeyValue label="Root domain">
                        <span className="font-mono text-xs">{rootDomain.data || window.location.host.split(".").slice(1).join(".")}</span>
                    </KeyValue>
                    <KeyValue label="Head block">
                        {head ? (
                            <span className="flex flex-wrap items-center gap-2 font-mono text-xs">
                                #{formatNumber(head.blockNum)}
                                <span className="text-muted-foreground">
                                    <TimeAgo time={head.time} />
                                </span>
                                <span className="text-muted-foreground">by</span>
                                <AccountLink name={head.producer} />
                            </span>
                        ) : "—"}
                    </KeyValue>
                    <KeyValue label="First visible block">
                        {firstBlock.data ? (
                            <span className="flex flex-wrap items-center gap-2 font-mono text-xs">
                                <Link to={`/blocks/${FIRST_VISIBLE_BLOCK}`} className="text-primary hover:underline">
                                    #{FIRST_VISIBLE_BLOCK}
                                </Link>
                                <span>{formatTime(firstBlock.data.time)}</span>
                                <span className="text-muted-foreground">(genesis block #1 is not displayable)</span>
                            </span>
                        ) : "—"}
                    </KeyValue>
                    <KeyValue label="Last snapshot">
                        {snapshot.data ? (
                            <span className="text-xs">
                                {formatTime(snapshot.data.lastSnapshot)}
                                <span className="text-muted-foreground">
                                    {" "}· interval {snapshot.data.snapshotInterval ? formatDuration(snapshot.data.snapshotInterval) : "disabled"}
                                </span>
                            </span>
                        ) : <span className="text-muted-foreground text-xs">unavailable</span>}
                    </KeyValue>
                    <KeyValue label="Installed packages">
                        {packages.data ? formatNumber(packages.data.length) : "—"}
                    </KeyValue>
                </Panel>

                <Panel title="Consensus">
                    <KeyValue label="Mode">
                        {producers.data ? (
                            <span className="flex items-center gap-2">
                                <Badge variant="outline" className="font-mono">{producers.data.mode}</Badge>
                                <span className="text-muted-foreground text-xs">
                                    {producers.data.mode === "BFT" ? "Byzantine fault tolerant" : producers.data.mode === "CFT" ? "Crash fault tolerant" : ""}
                                </span>
                            </span>
                        ) : "—"}
                    </KeyValue>
                    <KeyValue label="Producers">
                        <div className="flex flex-wrap gap-2">
                            {producers.data?.producers.map((p) => <AccountLink key={p.name} name={p.name} />)}
                        </div>
                    </KeyValue>
                    {producers.data?.nextConsensus && (
                        <KeyValue label="Pending change">
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="font-mono">{producers.data.nextMode}</Badge>
                                {producers.data.nextProducers.map((p) => <AccountLink key={p.name} name={p.name} />)}
                                {producers.data.jointStart && (
                                    <span className="text-muted-foreground text-xs">from #{formatNumber(producers.data.jointStart)}</span>
                                )}
                            </div>
                        </KeyValue>
                    )}
                    <KeyValue label="Term">{head?.term ?? "—"}</KeyValue>
                    <KeyValue label="Commit">
                        {head ? (
                            <span className="font-mono text-xs">
                                #{formatNumber(head.commitNum)}{" "}
                                <span className={stats.commitLag === 0 ? "text-emerald-500" : "text-amber-500"}>
                                    ({stats.commitLag === 0 ? "caught up" : `${stats.commitLag} behind head`})
                                </span>
                            </span>
                        ) : "—"}
                    </KeyValue>
                    {error && (
                        <KeyValue label="Feed error">
                            <span className="text-destructive text-xs">{error}</span>
                        </KeyValue>
                    )}
                </Panel>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                <Panel title="Block interval distribution" description={`Last ${formatNumber(stats.windowBlocks)} blocks`} bodyClassName="p-3">
                    <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={histogram} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                                <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                                <Tooltip
                                    cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                                    itemStyle={{ color: "var(--foreground)" }}
                                />
                                <Bar dataKey="count" name="Blocks" fill="var(--chart-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Panel>

                <Panel title="GraphQL endpoints" description="Query the chain directly">
                    <ul className="divide-y">
                        {API_SERVICES.map((s) => {
                            const url = siblingUrl(null, s.name, "/graphql");
                            return (
                                <li key={s.name} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                                    <div className="min-w-0">
                                        <a href={url} target="_blank" rel="noreferrer" className="text-primary font-mono hover:underline">
                                            {new URL(url).host}/graphql
                                        </a>
                                        <div className="text-muted-foreground truncate">{s.note}</div>
                                    </div>
                                    <AccountLink name={s.name} dot={false} className="shrink-0" />
                                </li>
                            );
                        })}
                    </ul>
                </Panel>
            </div>
        </div>
    );
};
