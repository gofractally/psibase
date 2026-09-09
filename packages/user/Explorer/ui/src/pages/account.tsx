import { useQuery } from "@tanstack/react-query";
import { ExternalLink, KeyRound, Package, Radio, Server, Store } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import { colorFor } from "@/lib/colors";
import { formatNumber, formatTime } from "@/lib/format";
import {
    fetchAccount,
    fetchAppMetadata,
    fetchAuthRecord,
    fetchCode,
    fetchInstalledPackages,
    fetchProducersInfo,
    fetchSiteConfig,
} from "@/lib/queries";

import { useLiveChain } from "@/store/use-live-chain";

import { AccountLink } from "@/components/account-link";
import { MethodChip } from "@/components/action-chips";
import { CopyIcon, Hash } from "@/components/hash";
import { KeyValue, PageHeader, Panel } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { TimeAgo } from "@/components/time-ago";
import { TransactionsTable } from "@/components/transactions-table";

import { Avatar } from "@shared/components/avatar";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { Switch } from "@shared/shadcn/ui/switch";

export const AccountPage = () => {
    const { name = "" } = useParams();
    const [showSystem, setShowSystem] = useState(false);

    const account = useQuery({
        queryKey: ["account", name],
        queryFn: () => fetchAccount(name),
        enabled: !!name,
    });
    const auth = useQuery({
        queryKey: ["account", name, "auth"],
        queryFn: () => fetchAuthRecord(name),
        enabled: !!name,
    });
    const code = useQuery({
        queryKey: ["account", name, "code"],
        queryFn: () => fetchCode(name),
        enabled: !!name,
    });
    const app = useQuery({
        queryKey: ["account", name, "app"],
        queryFn: () => fetchAppMetadata(name),
        enabled: !!name,
    });
    const site = useQuery({
        queryKey: ["account", name, "site"],
        queryFn: () => fetchSiteConfig(name),
        enabled: !!name,
    });
    const packages = useQuery({
        queryKey: ["packages", "installed"],
        queryFn: fetchInstalledPackages,
        staleTime: 5 * 60_000,
    });
    const producers = useQuery({
        queryKey: ["producers", "info"],
        queryFn: fetchProducersInfo,
        staleTime: 30_000,
    });

    const all = useLiveChain((s) => s.recentTransactions);
    const stats = useLiveChain((s) => s.stats);

    const activity = useMemo(() => {
        const source = all.filter((t) => showSystem || !t.isSystem);
        return source.filter((t) =>
            t.transaction.actions.some((a) => a.sender === name || a.service === name),
        );
    }, [all, name, showSystem]);

    const sentCount = useMemo(
        () =>
            all.reduce(
                (n, t) => n + t.transaction.actions.filter((a) => a.sender === name).length,
                0,
            ),
        [all, name],
    );
    const receivedCount = useMemo(
        () =>
            all.reduce(
                (n, t) =>
                    n +
                    t.transaction.actions.filter((a) => a.service === name && a.sender !== "").length,
                0,
            ),
        [all, name],
    );
    const receivedMethods = useMemo(() => {
        const m = new Map<string, number>();
        for (const t of all)
            for (const a of t.transaction.actions)
                if (a.service === name && a.sender !== "")
                    m.set(a.method, (m.get(a.method) ?? 0) + 1);
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    }, [all, name]);

    const pkg = packages.data?.find((p) => p.accounts.includes(name) || p.services.includes(name));
    const isProducer = producers.data?.producers.some((p) => p.name === name) ?? false;
    const producerStats = stats.producers.find((p) => p.name === name);
    const isService = !!code.data;
    // Corroborating evidence that the account exists even if the accounts
    // service lookup failed (never claim "does not exist" on a fetch error).
    const knownElsewhere = isProducer || isService || !!pkg || !!auth.data;
    const lookupFailed = account.isError;
    const exists = lookupFailed ? knownElsewhere : account.data !== null && account.data !== undefined;
    const siteUrl = siblingUrl(null, name, "/");

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title={
                    <span className="flex items-center gap-3">
                        <Avatar
                            account={name}
                            className="size-10 rounded-lg border-2 bg-card object-cover"
                            style={{ borderColor: colorFor(name) }}
                        />
                        <span className="font-mono">{name}</span>
                        <CopyIcon value={name} />
                        <span className="flex flex-wrap gap-1.5">
                            {isService && (
                                <Badge variant="secondary" className="gap-1">
                                    <Server className="size-3" /> Service
                                </Badge>
                            )}
                            {isProducer && (
                                <Badge className="gap-1 bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                                    <Radio className="size-3" /> Producer
                                </Badge>
                            )}
                            {app.data && (
                                <Badge variant="outline" className="gap-1">
                                    <Store className="size-3" /> {app.data.status || "App"}
                                </Badge>
                            )}
                        </span>
                    </span>
                }
                description={
                    account.isPending
                        ? "Loading…"
                        : lookupFailed
                          ? `Could not verify account with the accounts service (${(account.error as Error).message})`
                          : !exists
                            ? "This account does not exist on chain"
                            : app.data?.shortDesc || pkg?.description || `Account secured by ${account.data?.authService}`
                }
                actions={
                    site.data ? (
                        <Button asChild variant="outline" size="sm" className="h-8">
                            <a href={siteUrl} target="_blank" rel="noreferrer">
                                Open site <ExternalLink className="size-3.5" />
                            </a>
                        </Button>
                    ) : undefined
                }
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                    label="Actions sent"
                    accent="var(--chart-1)"
                    value={formatNumber(sentCount)}
                    sub={`in last ${formatNumber(stats.windowBlocks)} blocks`}
                />
                <StatCard
                    label="Actions received"
                    accent="var(--chart-2)"
                    value={formatNumber(receivedCount)}
                    sub={isService ? "calls into this service" : "not a service"}
                />
                <StatCard
                    label="Transactions"
                    accent="var(--chart-4)"
                    value={formatNumber(activity.length)}
                    sub="involving this account (window)"
                />
                {isProducer || producerStats ? (
                    <StatCard
                        label="Blocks produced"
                        accent="var(--chart-5)"
                        value={formatNumber(producerStats?.blocks ?? 0)}
                        sub={
                            producerStats ? (
                                <>
                                    last{" "}
                                    <Link to={`/blocks/${producerStats.lastBlockNum}`} className="text-primary font-mono hover:underline">
                                        #{formatNumber(producerStats.lastBlockNum)}
                                    </Link>{" "}
                                    <TimeAgo time={producerStats.lastBlockTime} />
                                </>
                            ) : (
                                "none in window"
                            )
                        }
                    />
                ) : (
                    <StatCard
                        label="Auth sequence"
                        accent="var(--chart-3)"
                        value={account.data?.authSequence ?? "—"}
                        sub="auth changes"
                    />
                )}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                <Panel title="Identity & authorization">
                    <KeyValue label="Account">
                        <span className="font-mono">{name}</span>
                    </KeyValue>
                    <KeyValue label="Auth service">
                        {account.isPending ? (
                            <Skeleton className="h-4 w-24" />
                        ) : account.data ? (
                            <AccountLink name={account.data.authService} />
                        ) : (
                            <span className="text-muted-foreground">—</span>
                        )}
                    </KeyValue>
                    <KeyValue label="Public key">
                        {auth.isPending ? (
                            <Skeleton className="h-4 w-48" />
                        ) : auth.data?.pubkey ? (
                            <span className="flex items-start gap-2">
                                <KeyRound className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                                <pre className="font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                                    {auth.data.pubkey.trim()}
                                </pre>
                                <CopyIcon value={auth.data.pubkey} />
                            </span>
                        ) : (
                            <span className="text-muted-foreground text-xs">
                                No auth-sig key registered
                            </span>
                        )}
                    </KeyValue>
                    {pkg && (
                        <KeyValue label="Package">
                            <span className="flex flex-wrap items-center gap-2">
                                <Package className="text-muted-foreground size-3.5" />
                                <Link to={`/services?q=${encodeURIComponent(pkg.name)}`} className="text-primary hover:underline">
                                    {pkg.name}
                                </Link>
                                <span className="text-muted-foreground font-mono text-xs">v{pkg.version}</span>
                                <span className="text-muted-foreground text-xs">owned by</span>
                                <AccountLink name={pkg.owner} />
                            </span>
                        </KeyValue>
                    )}
                    {app.data && (
                        <>
                            <KeyValue label="App name">{app.data.name}</KeyValue>
                            {app.data.tags.length > 0 && (
                                <KeyValue label="Tags">
                                    <span className="flex flex-wrap gap-1">
                                        {app.data.tags.map((t) => (
                                            <Badge key={t} variant="outline" className="text-[10px]">
                                                {t}
                                            </Badge>
                                        ))}
                                    </span>
                                </KeyValue>
                            )}
                            <KeyValue label="Registered">{formatTime(app.data.createdAt)}</KeyValue>
                        </>
                    )}
                </Panel>

                <Panel title={isService ? "Service code" : "Code & site"}>
                    {code.isPending ? (
                        <div className="p-4">
                            <Skeleton className="h-4 w-40" />
                        </div>
                    ) : code.data ? (
                        <>
                            <KeyValue label="Code hash">
                                <Hash value={code.data.codeHash} full />
                            </KeyValue>
                            <KeyValue label="VM">
                                <span className="font-mono text-xs">
                                    type {code.data.vmType} · version {code.data.vmVersion}
                                </span>
                            </KeyValue>
                            <KeyValue label="Flags">
                                {code.data.flags.length === 0 ? (
                                    <span className="text-muted-foreground text-xs">none</span>
                                ) : (
                                    <span className="flex flex-wrap gap-1">
                                        {code.data.flags.map((f) => (
                                            <Badge key={f} variant="secondary" className="font-mono text-[10px]">
                                                {f}
                                            </Badge>
                                        ))}
                                    </span>
                                )}
                            </KeyValue>
                            {receivedMethods.length > 0 && (
                                <KeyValue label="Methods called">
                                    <span className="flex flex-wrap gap-1">
                                        {receivedMethods.map(([m, c]) => (
                                            <span key={m} className="inline-flex items-center gap-1">
                                                <MethodChip service={name} method={m} />
                                                <span className="text-muted-foreground font-mono text-[10px]">×{c}</span>
                                            </span>
                                        ))}
                                    </span>
                                </KeyValue>
                            )}
                        </>
                    ) : (
                        <KeyValue label="Code">
                            <span className="text-muted-foreground text-xs">
                                No WASM deployed on this account
                            </span>
                        </KeyValue>
                    )}
                    <KeyValue label="Website">
                        {site.data ? (
                            <span className="flex flex-wrap items-center gap-2 text-xs">
                                <a href={siteUrl} target="_blank" rel="noreferrer" className="text-primary font-mono hover:underline">
                                    {new URL(siteUrl).host}
                                </a>
                                {site.data.spa && <Badge variant="outline" className="text-[10px]">SPA</Badge>}
                                {site.data.cache && <Badge variant="outline" className="text-[10px]">cached</Badge>}
                            </span>
                        ) : (
                            <span className="text-muted-foreground text-xs">No site configuration</span>
                        )}
                    </KeyValue>
                </Panel>
            </div>

            <Panel
                title={`Recent activity (${activity.length})`}
                description="Transactions in the live window where this account is a sender or the called service"
                actions={
                    <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <Switch checked={showSystem} onCheckedChange={setShowSystem} className="scale-90" />
                        System
                    </label>
                }
            >
                <TransactionsTable
                    transactions={activity.slice(0, 100)}
                    emptyMessage="No recent transactions involve this account"
                />
            </Panel>
        </div>
    );
};
