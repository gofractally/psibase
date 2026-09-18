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
    fetchAuthDelegateOwner,
    fetchAuthDynManagement,
    fetchAuthDynPolicy,
    fetchAuthRecord,
    fetchCode,
    fetchInstalledPackages,
    fetchProducersInfo,
    fetchSiteConfig,
} from "@/lib/queries";

import { useLiveChain } from "@/store/use-live-chain";

import { AccountLink } from "@/components/account-link";
import { MethodChip } from "@/components/action-chips";
import { DocLabel } from "@/components/doc-link";
import { CopyIcon, Hash } from "@/components/hash";
import { KeyValue, PageHeader, Panel } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { TimeAgo } from "@/components/time-ago";
import { TransactionsTable } from "@/components/transactions-table";
import { DOC_PATHS } from "@/lib/docs";

import { Avatar } from "@shared/components/avatar";
import { cn } from "@shared/lib/utils";
import { useProfile } from "@shared/hooks/use-profile";
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
    const authService = account.data?.authService;
    const authSig = useQuery({
        queryKey: ["account", name, "auth-sig"],
        queryFn: () => fetchAuthRecord(name),
        enabled: !!name && authService === "auth-sig",
    });
    const authDelg = useQuery({
        queryKey: ["account", name, "auth-delg"],
        queryFn: () => fetchAuthDelegateOwner(name),
        enabled: !!name && authService === "auth-delg",
    });
    const authDynMgmt = useQuery({
        queryKey: ["account", name, "auth-dyn", "management"],
        queryFn: () => fetchAuthDynManagement(name),
        enabled: !!name && authService === "auth-dyn",
    });
    const authDynPolicy = useQuery({
        queryKey: ["account", name, "auth-dyn", "policy"],
        queryFn: () => fetchAuthDynPolicy(name),
        enabled: !!name && authService === "auth-dyn",
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
    const profile = useProfile(name || null);

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
    const knownElsewhere = isProducer || isService || !!pkg || !!authSig.data || !!authDelg.data || !!authDynMgmt.data;
    const lookupFailed = account.isError;
    const exists = lookupFailed ? knownElsewhere : account.data !== null && account.data !== undefined;
    const siteUrl = siblingUrl(null, name, "/");
    const displayName = profile.data?.profile?.displayName?.trim() || "";
    const bio = profile.data?.profile?.bio?.trim() || "";
    const headerDescription = account.isPending
        ? "Loading…"
        : lookupFailed
          ? `Could not verify account with the accounts service (${(account.error as Error).message})`
          : !exists
            ? "This account does not exist on the network"
            : bio || app.data?.shortDesc || pkg?.description || undefined;

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title={
                    <span
                        className={cn(
                            "flex gap-3",
                            displayName ? "items-start" : "items-center",
                        )}
                    >
                        <Avatar
                            account={name}
                            className="size-10 shrink-0 rounded-lg border-2 bg-card object-cover"
                            style={{ borderColor: colorFor(name) }}
                        />
                        <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
                            {displayName ? (
                                <span className="truncate text-xl leading-tight">
                                    {displayName}
                                </span>
                            ) : null}
                            <span className="flex flex-wrap items-center gap-1.5">
                                <span
                                    className={
                                        displayName
                                            ? "text-muted-foreground font-mono text-sm font-normal"
                                            : "font-mono"
                                    }
                                >
                                    {name}
                                </span>
                                <CopyIcon value={name} />
                                <span className="flex flex-wrap gap-1.5">
                                    {isService && (
                                        <Badge variant="secondary" className="gap-1">
                                            <Server className="size-3" /> Service
                                        </Badge>
                                    )}
                                    {isProducer && (
                                        <Badge className="gap-1 bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                                            <Radio className="size-3" /> Provider
                                        </Badge>
                                    )}
                                    {app.data && (
                                        <Badge variant="outline" className="gap-1">
                                            <Store className="size-3" /> {app.data.status || "App"}
                                        </Badge>
                                    )}
                                </span>
                            </span>
                            {displayName && headerDescription ? (
                                <span className="text-muted-foreground pt-0.5 text-sm font-normal leading-snug">
                                    {headerDescription}
                                </span>
                            ) : null}
                        </span>
                    </span>
                }
                description={displayName ? undefined : headerDescription}
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
                        label="Blocks"
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
                    {displayName ? (
                        <KeyValue label="Display name">{displayName}</KeyValue>
                    ) : null}
                    {bio ? (
                        <KeyValue label="Bio">
                            <span className="text-sm whitespace-pre-wrap">{bio}</span>
                        </KeyValue>
                    ) : null}
                    <KeyValue
                        label={
                            <DocLabel
                                path={
                                    authService === "auth-sig"
                                        ? DOC_PATHS.authSig
                                        : DOC_PATHS.smartAuthorization
                                }
                                topic="auth services"
                            >
                                Auth service
                            </DocLabel>
                        }
                    >
                        {account.isPending ? (
                            <Skeleton className="h-4 w-24" />
                        ) : account.data ? (
                            <AccountLink name={account.data.authService} />
                        ) : (
                            <span className="text-muted-foreground">—</span>
                        )}
                    </KeyValue>
                    {authService === "auth-sig" && (
                        <KeyValue label="Public key">
                            {authSig.isPending ? (
                                <Skeleton className="h-4 w-48" />
                            ) : authSig.data?.pubkey ? (
                                <span className="flex items-start gap-2">
                                    <KeyRound className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                                    <pre className="font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                                        {authSig.data.pubkey.trim()}
                                    </pre>
                                    <CopyIcon value={authSig.data.pubkey} />
                                </span>
                            ) : (
                                <span className="text-muted-foreground text-xs">
                                    No auth-sig key registered
                                </span>
                            )}
                        </KeyValue>
                    )}
                    {authService === "auth-delg" && (
                        <KeyValue label="Owner account">
                            {authDelg.isPending ? (
                                <Skeleton className="h-4 w-24" />
                            ) : authDelg.data?.owner ? (
                                <AccountLink name={authDelg.data.owner} />
                            ) : (
                                <span className="text-muted-foreground text-xs">
                                    No owner registered
                                </span>
                            )}
                        </KeyValue>
                    )}
                    {authService === "auth-dyn" && (
                        <>
                            <KeyValue label="Manager">
                                {authDynMgmt.isPending ? (
                                    <Skeleton className="h-4 w-24" />
                                ) : authDynMgmt.data?.manager ? (
                                    <AccountLink name={authDynMgmt.data.manager} />
                                ) : (
                                    <span className="text-muted-foreground text-xs">
                                        No manager registered
                                    </span>
                                )}
                            </KeyValue>
                            <KeyValue label="Policy">
                                {authDynPolicy.isPending || authDynMgmt.isPending ? (
                                    <Skeleton className="h-4 w-48" />
                                ) : authDynPolicy.data ? (
                                    <div className="flex flex-col gap-1.5 text-xs">
                                        <span className="text-muted-foreground">
                                            {authDynPolicy.data.authorizers.length === 0
                                                ? "Impossible (no authorizers)"
                                                : `Threshold ${authDynPolicy.data.threshold} of ${authDynPolicy.data.authorizers.reduce((n, a) => n + a.weight, 0)} weight`}
                                        </span>
                                        {authDynPolicy.data.authorizers.length > 0 && (
                                            <ul className="flex flex-col gap-1">
                                                {authDynPolicy.data.authorizers.map((a) => (
                                                    <li
                                                        key={a.account}
                                                        className="flex flex-wrap items-center gap-2"
                                                    >
                                                        <AccountLink name={a.account} />
                                                        <span className="text-muted-foreground font-mono">
                                                            weight {a.weight}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                ) : (
                                    <span className="text-muted-foreground text-xs">
                                        Policy unavailable from manager
                                    </span>
                                )}
                            </KeyValue>
                        </>
                    )}
                    {pkg && (
                        <KeyValue
                            label={
                                <DocLabel path={DOC_PATHS.packages} topic="app packages">
                                    Package
                                </DocLabel>
                            }
                        >
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
