import { useQuery } from "@tanstack/react-query";
import {
    ArrowLeftRight,
    Coins,
    ExternalLink,
    Fuel,
    Gauge,
    KeyRound,
    Layers,
    LayoutGrid,
    Package,
    Radio,
    Server,
    Settings,
    Store,
    UserRound,
} from "lucide-react";
import { Link } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import { AccountLink } from "@/components/account-link";
import { MethodChip } from "@/components/action-chips";
import { CopyIcon } from "@/components/hash";
import { ConsumptionBreakdown } from "@/components/me/consumption-breakdown";
import { ResourceBuffer, formatUnits } from "@/components/me/resource-buffer";
import { ResourcePrices } from "@/components/me/resource-prices";
import {
    PendingTransfers,
    RecentTransfers,
    TokenBalances,
} from "@/components/me/token-panels";
import { UserActivityChart } from "@/components/me/user-activity-chart";
import { KeyValue, Panel } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { TimeAgo } from "@/components/time-ago";
import { TransactionsTable } from "@/components/transactions-table";

import {
    useConsumedHistory,
    usePendingTransfers,
    useResourcePricing,
    useResourcesStatus,
    useTokenTransfers,
    useUserActivity,
    useUserResources,
} from "@/hooks/use-user-dashboard";
import { colorFor } from "@/lib/colors";
import { formatDuration, formatNumber, pct } from "@/lib/format";
import {
    fetchAccount,
    fetchAppMetadata,
    fetchAuthRecord,
    fetchCode,
    fetchInstalledPackages,
    fetchNetworkName,
    fetchProducersInfo,
    fetchSiteConfig,
} from "@/lib/queries";

import { Avatar } from "@shared/components/avatar";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useProfile } from "@shared/hooks/use-profile";
import {
    getSystemTokenBalance,
    useUserTokenBalances,
} from "@shared/hooks/use-user-token-balances";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const MyDashboardPage = () => {
    const { data: currentUser, isPending: userPending } = useCurrentUser();
    const user = currentUser ?? null;

    if (userPending) return <HeroSkeleton />;
    if (!user) {
        return (
            <div className="text-muted-foreground flex h-[50vh] flex-col items-center justify-center gap-2 text-sm">
                <UserRound className="size-6 opacity-60" />
                Sign in to see your personal dashboard.
            </div>
        );
    }
    return <Dashboard user={user} />;
};

const Dashboard = ({ user }: { user: string }) => {
    // Public facts about the account (same sources as the public account page)
    const account = useQuery({
        queryKey: ["account", user],
        queryFn: () => fetchAccount(user),
    });
    const authService = account.data?.authService;
    const authSig = useQuery({
        queryKey: ["account", user, "auth-sig"],
        queryFn: () => fetchAuthRecord(user),
        enabled: authService === "auth-sig",
    });
    const code = useQuery({
        queryKey: ["account", user, "code"],
        queryFn: () => fetchCode(user),
    });
    const app = useQuery({
        queryKey: ["account", user, "app"],
        queryFn: () => fetchAppMetadata(user),
    });
    const site = useQuery({
        queryKey: ["account", user, "site"],
        queryFn: () => fetchSiteConfig(user),
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
    const { data: networkName } = useQuery({
        queryKey: ["branding", "name"],
        queryFn: fetchNetworkName,
        staleTime: Infinity,
    });
    const profile = useProfile(user);

    // Private, user-authorized data
    const status = useResourcesStatus();
    const symbol = status.systemToken?.symbol ?? "";
    const precision = status.systemToken?.precision ?? 4;
    const resources = useUserResources(user, status.resourcesAvailable);
    const consumed = useConsumedHistory(user, status.resourcesAvailable);
    const balances = useUserTokenBalances(user, {
        enabled: status.hasSystemToken,
    });
    const pending = usePendingTransfers(user, status.hasSystemToken);
    const transfers = useTokenTransfers(
        user,
        status.systemToken?.id,
        status.hasSystemToken,
    );
    const pricing = useResourcePricing(status.resourcesAvailable);

    // Live-window activity
    const activity = useUserActivity(user);

    const isService = !!code.data;
    const isProducer =
        producers.data?.producers.some((p) => p.name === user) ?? false;
    const ownedPackages = packages.data?.filter((p) => p.owner === user) ?? [];
    const memberOfPackage = packages.data?.find(
        (p) => p.accounts.includes(user) || p.services.includes(user),
    );
    const displayName = profile.data?.profile?.displayName?.trim() || "";
    const bio = profile.data?.profile?.bio?.trim() || "";
    const systemBalance = status.systemToken
        ? getSystemTokenBalance(balances.data, status.systemToken.id)
        : undefined;
    const settingsUrl = siblingUrl(null, null, "/settings");
    // The VirtualServer plugin only answers user-scoped queries for first-party
    // apps; when it refuses Explorer we point at Settings instead of erroring.
    const resourcesRefused = resources.isError;
    const REFUSED_MESSAGE =
        "Your resource buffer and consumption history are only readable by first-party apps on this network. Open Settings to see and refill your buffer.";

    const bufferFill =
        resources.data && resources.data.bufferCapacity > 0
            ? (resources.data.balance / resources.data.bufferCapacity) * 100
            : null;
    const topService = activity.services[0];

    return (
        <div className="flex flex-col gap-4">
            {/* ------------------------------------------------------------ hero */}
            <div className="grid-bg -mx-4 -mt-4 px-4 pb-2 pt-6 md:-mx-6 md:-mt-6 md:px-6">
                {/* Actions drop below the identity block until there is room for both. */}
                <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                        <Avatar
                            account={user}
                            className="bg-card size-12 shrink-0 rounded-xl border-2 object-cover"
                            style={{ borderColor: colorFor(user) }}
                        />
                        <div className="min-w-0 flex-1">
                            <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-[0.2em]">
                                {networkName || "psibase"} · signed in as
                            </div>
                            <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-3xl font-semibold tracking-tight">
                                <span
                                    className="min-w-0 max-w-full truncate"
                                    title={displayName || user}
                                >
                                    {displayName || user}
                                </span>
                                {displayName && (
                                    <span className="text-muted-foreground font-mono text-base font-normal">
                                        {user}
                                    </span>
                                )}
                                <CopyIcon value={user} className="mt-1" />
                            </h1>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                {isProducer && (
                                    <Badge className="gap-1 bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                                        <Radio className="size-3" /> Provider
                                    </Badge>
                                )}
                                {isService && (
                                    <Badge
                                        variant="secondary"
                                        className="gap-1"
                                    >
                                        <Server className="size-3" /> Service
                                    </Badge>
                                )}
                                {app.data && (
                                    <Badge variant="outline" className="gap-1">
                                        <Store className="size-3" />{" "}
                                        {app.data.status || "App"}
                                    </Badge>
                                )}
                                {ownedPackages.length > 0 && (
                                    <Badge variant="outline" className="gap-1">
                                        <Package className="size-3" />
                                        {ownedPackages.length}{" "}
                                        {ownedPackages.length === 1
                                            ? "package"
                                            : "packages"}
                                    </Badge>
                                )}
                                {bio && (
                                    <span
                                        className="text-muted-foreground min-w-0 max-w-full truncate text-sm"
                                        title={bio}
                                    >
                                        {bio}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
                        <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-8"
                        >
                            <Link to={`/accounts/${user}`}>
                                <UserRound className="size-3.5" /> Public
                                profile
                            </Link>
                        </Button>
                        <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-8"
                        >
                            <a
                                href={settingsUrl}
                                target="_blank"
                                rel="noreferrer"
                            >
                                <Settings className="size-3.5" /> Manage account{" "}
                                <ExternalLink className="size-3" />
                            </a>
                        </Button>
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <StatCard
                        label="Actions sent"
                        icon={Layers}
                        accent="var(--chart-2)"
                        value={formatNumber(activity.actionsSent)}
                        sub={`in last ${formatNumber(activity.windowBlocks)} blocks · ${formatDuration(activity.windowSeconds)}`}
                        spark={activity.spark.slice(-90)}
                    />
                    <StatCard
                        label="Transactions"
                        icon={ArrowLeftRight}
                        accent="var(--chart-1)"
                        value={formatNumber(activity.sent.length)}
                        sub={
                            activity.lastSent ? (
                                <>
                                    last{" "}
                                    <TimeAgo
                                        time={activity.lastSent.blockTime}
                                    />{" "}
                                    in{" "}
                                    <Link
                                        to={`/blocks/${activity.lastSent.blockNum}`}
                                        className="text-primary font-mono hover:underline"
                                    >
                                        #
                                        {formatNumber(
                                            activity.lastSent.blockNum,
                                        )}
                                    </Link>
                                </>
                            ) : (
                                "none in the live window"
                            )
                        }
                    />
                    <StatCard
                        label="Services used"
                        icon={LayoutGrid}
                        accent="var(--chart-4)"
                        value={formatNumber(activity.services.length)}
                        sub={
                            topService ? (
                                <>
                                    mostly{" "}
                                    <AccountLink
                                        name={topService.service}
                                        dot={false}
                                        mono={false}
                                        className="text-xs"
                                    />{" "}
                                    (
                                    {pct(
                                        topService.count,
                                        activity.actionsSent,
                                        0,
                                    )}
                                    )
                                </>
                            ) : (
                                "no calls yet"
                            )
                        }
                    />
                    {status.resourcesAvailable ? (
                        <StatCard
                            label="Resource buffer"
                            icon={Fuel}
                            accent={
                                bufferFill !== null &&
                                bufferFill <=
                                    (resources.data?.autoFillThresholdPercent ??
                                        0)
                                    ? "var(--chart-5)"
                                    : "var(--chart-3)"
                            }
                            value={
                                resources.isPending ? (
                                    <Skeleton className="h-7 w-16" />
                                ) : resources.isError ? (
                                    <span className="text-muted-foreground text-base">
                                        unavailable
                                    </span>
                                ) : bufferFill === null ? (
                                    <span className="text-muted-foreground">
                                        empty
                                    </span>
                                ) : (
                                    `${bufferFill.toFixed(bufferFill < 10 ? 1 : 0)}%`
                                )
                            }
                            sub={
                                resources.data
                                    ? `${formatUnits(resources.data.balance, precision)} / ${formatUnits(resources.data.bufferCapacity, precision)} ${symbol}`
                                    : resourcesRefused
                                      ? "details available in Settings"
                                      : "prepaid CPU · net · storage"
                            }
                        />
                    ) : (
                        <StatCard
                            label="Calls received"
                            icon={Server}
                            accent="var(--chart-3)"
                            value={formatNumber(activity.actionsReceived)}
                            sub={
                                isService
                                    ? "into your service (window)"
                                    : "your account is not a service"
                            }
                        />
                    )}
                    {status.hasSystemToken ? (
                        <StatCard
                            label={`${symbol} balance`}
                            icon={Coins}
                            accent="var(--chart-1)"
                            value={
                                balances.isPending ? (
                                    <Skeleton className="h-7 w-20" />
                                ) : balances.isError ? (
                                    <span className="text-muted-foreground text-base">
                                        unavailable
                                    </span>
                                ) : (
                                    (systemBalance?.format({
                                        includeLabel: false,
                                    }) ?? "0")
                                )
                            }
                            sub={
                                pending.data && pending.data.length > 0
                                    ? `${pending.data.length} pending ${pending.data.length === 1 ? "credit" : "credits"}`
                                    : "liquid balance · system token"
                            }
                        />
                    ) : (
                        <StatCard
                            label="Packages owned"
                            icon={Package}
                            accent="var(--chart-1)"
                            value={
                                packages.isPending ? (
                                    <Skeleton className="h-7 w-10" />
                                ) : (
                                    formatNumber(ownedPackages.length)
                                )
                            }
                            sub={
                                ownedPackages.length
                                    ? ownedPackages
                                          .slice(0, 2)
                                          .map((p) => p.name)
                                          .join(", ") +
                                      (ownedPackages.length > 2 ? ", …" : "")
                                    : "installed packages you own"
                            }
                        />
                    )}
                    <StatCard
                        label="Auth sequence"
                        icon={KeyRound}
                        accent="var(--chart-5)"
                        value={
                            account.isPending ? (
                                <Skeleton className="h-7 w-16" />
                            ) : (
                                (account.data?.authSequence ?? "—")
                            )
                        }
                        sub={
                            authService ? (
                                <>
                                    guarded by{" "}
                                    <AccountLink
                                        name={authService}
                                        dot={false}
                                        mono
                                        className="text-xs"
                                    />
                                </>
                            ) : (
                                "auth changes on this account"
                            )
                        }
                    />
                </div>
            </div>

            {/* ------------------------------------------------------- resources */}
            {status.resourcesAvailable && (
                <div className="grid gap-4 xl:grid-cols-3">
                    <Panel
                        title="Resource buffer"
                        description={`Prepaid ${symbol} that pays for the CPU, bandwidth and storage your transactions use`}
                        className="xl:col-span-2"
                        actions={
                            <Button
                                asChild
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                            >
                                <a
                                    href={settingsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    <Fuel className="size-3.5" /> Refill or
                                    resize <ExternalLink className="size-3" />
                                </a>
                            </Button>
                        }
                        bodyClassName="p-4"
                    >
                        {resourcesRefused ? (
                            <div className="text-muted-foreground flex flex-col gap-2 text-sm">
                                <span>{REFUSED_MESSAGE}</span>
                                <span className="text-xs">
                                    Fees on this network go to{" "}
                                    {status.feeReceiver ? (
                                        <AccountLink
                                            name={status.feeReceiver}
                                            dot={false}
                                            className="text-xs"
                                        />
                                    ) : (
                                        "the network"
                                    )}
                                    ; current prices are shown below.
                                </span>
                            </div>
                        ) : (
                            <ResourceBuffer
                                resources={resources.data}
                                symbol={symbol}
                                precision={precision}
                                isPending={resources.isPending}
                            />
                        )}
                        {!status.billingEnabled && (
                            <div className="text-muted-foreground mt-3 rounded-md border border-dashed px-3 py-2 text-xs">
                                Billing is configured but currently paused by
                                the network, so your buffer is not being drawn
                                down right now.
                            </div>
                        )}
                    </Panel>

                    <Panel
                        title="Your tokens"
                        description="Balances held by this account"
                        actions={
                            <Button
                                asChild
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                            >
                                <a
                                    href={siblingUrl(null, null, "/tokens")}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    Wallet <ExternalLink className="size-3" />
                                </a>
                            </Button>
                        }
                    >
                        <TokenBalances
                            balances={balances.data}
                            systemTokenId={status.systemToken?.id ?? null}
                            isPending={balances.isPending}
                            isError={balances.isError}
                        />
                        <div className="text-muted-foreground border-t px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider">
                            Pending
                        </div>
                        <PendingTransfers
                            user={user}
                            pending={pending.data}
                            isPending={pending.isPending}
                        />
                    </Panel>
                </div>
            )}

            {status.resourcesAvailable && (
                <div className="grid gap-4 xl:grid-cols-3">
                    <Panel
                        title="What you've been paying for"
                        description="Metered CPU, network and storage charged to your buffer, most recent first"
                        className="xl:col-span-2"
                    >
                        <ConsumptionBreakdown
                            events={consumed.data}
                            symbol={symbol}
                            precision={precision}
                            isPending={consumed.isPending}
                            isError={consumed.isError}
                            errorMessage={
                                consumed.isError
                                    ? resourcesRefused
                                        ? REFUSED_MESSAGE
                                        : (consumed.error as Error).message
                                    : undefined
                            }
                        />
                    </Panel>
                    <Panel
                        title="What resources cost right now"
                        description={
                            status.billingEnabled
                                ? "Live market prices your transactions pay"
                                : "Billing is paused, but these are the current quotes"
                        }
                    >
                        <ResourcePrices
                            pricing={pricing.data}
                            symbol={symbol}
                            precision={precision}
                            isPending={pricing.isPending}
                            isError={pricing.isError}
                        />
                    </Panel>
                </div>
            )}

            {/* Tokens without billing: still show the wallet panel */}
            {status.hasSystemToken && !status.resourcesAvailable && (
                <div className="grid gap-4 xl:grid-cols-3">
                    <Panel
                        title="Your tokens"
                        description="Balances held by this account"
                        className="xl:col-span-1"
                    >
                        <TokenBalances
                            balances={balances.data}
                            systemTokenId={status.systemToken?.id ?? null}
                            isPending={balances.isPending}
                            isError={balances.isError}
                        />
                    </Panel>
                    <Panel
                        title="Pending credits"
                        description="Open lines of credit involving you"
                        className="xl:col-span-2"
                    >
                        <PendingTransfers
                            user={user}
                            pending={pending.data}
                            isPending={pending.isPending}
                        />
                    </Panel>
                </div>
            )}

            {/* -------------------------------------------------------- activity */}
            <div className="grid gap-4 xl:grid-cols-3">
                <Panel
                    title="Your activity"
                    description={
                        isService
                            ? "Actions you sent (blue) and calls into your service (amber) across the live window"
                            : "Actions you sent across the live window"
                    }
                    className="xl:col-span-2"
                    bodyClassName="px-2 pt-3 pb-1"
                >
                    {activity.series.length > 1 ? (
                        activity.actionsSent + activity.actionsReceived > 0 ? (
                            <UserActivityChart
                                series={activity.series}
                                showReceived={isService}
                                height={240}
                            />
                        ) : (
                            <div className="text-muted-foreground flex h-[240px] flex-col items-center justify-center gap-1 text-sm">
                                <Gauge className="size-4 opacity-60" />
                                Nothing from you in the last{" "}
                                {formatNumber(activity.windowBlocks)} blocks
                            </div>
                        )
                    ) : (
                        <Skeleton className="m-2 h-[220px]" />
                    )}
                </Panel>
                <Panel
                    title="Services you use"
                    description="Methods you called, most frequent first"
                    bodyClassName="p-2"
                >
                    {activity.methods.length === 0 ? (
                        <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
                            No calls in the current window
                        </div>
                    ) : (
                        <ul className="flex flex-col">
                            {activity.methods.slice(0, 10).map((m) => (
                                <li
                                    key={m.key}
                                    className="hover:bg-accent/40 flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
                                >
                                    <MethodChip
                                        service={m.service}
                                        method={m.method}
                                    />
                                    <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                                        {formatNumber(m.count)}
                                        <span className="ml-1 opacity-60">
                                            {pct(
                                                m.count,
                                                activity.actionsSent,
                                                0,
                                            )}
                                        </span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
            </div>

            <Panel
                title={`Your recent transactions (${activity.sent.length})`}
                description="Transactions in the live window where you signed at least one action"
                actions={
                    <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                    >
                        <Link to={`/accounts/${user}`}>Full account view</Link>
                    </Button>
                }
            >
                <TransactionsTable
                    transactions={activity.sent.slice(0, 50)}
                    emptyMessage="You haven't sent any transactions in the live window"
                />
            </Panel>

            {isService && (
                <div className="grid gap-4 xl:grid-cols-3">
                    <Panel
                        title={`Calls into your service (${activity.received.length})`}
                        description="Other accounts invoking methods on your account"
                        className="xl:col-span-2"
                    >
                        <TransactionsTable
                            transactions={activity.received.slice(0, 25)}
                            compact
                            emptyMessage="Nobody has called your service in the live window"
                        />
                    </Panel>
                    <Panel
                        title="Top callers"
                        description="By actions into your service"
                        bodyClassName="p-2"
                    >
                        {activity.callers.length === 0 ? (
                            <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
                                No callers yet
                            </div>
                        ) : (
                            <ul className="flex flex-col">
                                {activity.callers.slice(0, 8).map((c, i) => (
                                    <li
                                        key={c.sender}
                                        className="hover:bg-accent/40 flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
                                    >
                                        <span className="flex items-center gap-2">
                                            <span className="text-muted-foreground w-4 text-right font-mono text-[10px]">
                                                {i + 1}
                                            </span>
                                            <AccountLink name={c.sender} />
                                        </span>
                                        <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                                            {formatNumber(c.count)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Panel>
                </div>
            )}

            {status.hasSystemToken && (
                <Panel
                    title={`Recent ${symbol} transfers`}
                    description="Credits and debits of the system token involving your account"
                >
                    <RecentTransfers
                        transfers={transfers.data}
                        symbol={symbol}
                        isPending={transfers.isPending}
                        isError={transfers.isError}
                        errorMessage={
                            transfers.error
                                ? (transfers.error as Error).message
                                : undefined
                        }
                    />
                </Panel>
            )}

            {/* -------------------------------------------------------- identity */}
            <div className="grid gap-4 xl:grid-cols-2">
                <Panel title="Identity & keys">
                    <KeyValue label="Account">
                        <span className="font-mono">{user}</span>
                    </KeyValue>
                    {displayName && (
                        <KeyValue label="Display name">{displayName}</KeyValue>
                    )}
                    <KeyValue label="Auth service">
                        {account.isPending ? (
                            <Skeleton className="h-4 w-24" />
                        ) : authService ? (
                            <AccountLink name={authService} />
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
                                    <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
                                        {authSig.data.pubkey.trim()}
                                    </pre>
                                    <CopyIcon value={authSig.data.pubkey} />
                                </span>
                            ) : (
                                <span className="text-muted-foreground text-xs">
                                    No key registered
                                </span>
                            )}
                        </KeyValue>
                    )}
                    <KeyValue label="Profile">
                        {profile.data?.profile ? (
                            <span className="text-xs">
                                {bio || (
                                    <span className="text-muted-foreground">
                                        No bio
                                    </span>
                                )}
                            </span>
                        ) : (
                            <a
                                href={settingsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                            >
                                Set up a display name and bio{" "}
                                <ExternalLink className="size-3" />
                            </a>
                        )}
                    </KeyValue>
                </Panel>

                <Panel title="What you own on the network">
                    <KeyValue label="Packages">
                        {packages.isPending ? (
                            <Skeleton className="h-4 w-32" />
                        ) : ownedPackages.length === 0 ? (
                            <span className="text-muted-foreground text-xs">
                                You don't own any installed packages
                            </span>
                        ) : (
                            <ul className="flex flex-col gap-1">
                                {ownedPackages.map((p) => (
                                    <li
                                        key={p.name}
                                        className="flex flex-wrap items-center gap-2 text-xs"
                                    >
                                        <Package className="text-muted-foreground size-3.5" />
                                        <Link
                                            to={`/services?q=${encodeURIComponent(p.name)}`}
                                            className="text-primary hover:underline"
                                        >
                                            {p.name}
                                        </Link>
                                        <span className="text-muted-foreground font-mono">
                                            v{p.version}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {p.services.length}{" "}
                                            {p.services.length === 1
                                                ? "service"
                                                : "services"}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </KeyValue>
                    {memberOfPackage && (
                        <KeyValue label="Part of package">
                            <span className="flex flex-wrap items-center gap-2 text-xs">
                                <Link
                                    to={`/services?q=${encodeURIComponent(memberOfPackage.name)}`}
                                    className="text-primary hover:underline"
                                >
                                    {memberOfPackage.name}
                                </Link>
                                <span className="text-muted-foreground">
                                    owned by
                                </span>
                                <AccountLink name={memberOfPackage.owner} />
                            </span>
                        </KeyValue>
                    )}
                    <KeyValue label="Registered app">
                        {app.data ? (
                            <span className="flex flex-wrap items-center gap-2 text-xs">
                                <Store className="text-muted-foreground size-3.5" />
                                {app.data.name}
                                {app.data.tags.map((t) => (
                                    <Badge
                                        key={t}
                                        variant="outline"
                                        className="text-[10px]"
                                    >
                                        {t}
                                    </Badge>
                                ))}
                            </span>
                        ) : (
                            <span className="text-muted-foreground text-xs">
                                Not registered in the app registry
                            </span>
                        )}
                    </KeyValue>
                    <KeyValue label="Service code">
                        {code.isPending ? (
                            <Skeleton className="h-4 w-40" />
                        ) : code.data ? (
                            <span className="font-mono text-xs">
                                {code.data.codeHash.slice(0, 16)}… · vm{" "}
                                {code.data.vmType}.{code.data.vmVersion}
                            </span>
                        ) : (
                            <span className="text-muted-foreground text-xs">
                                No WASM deployed on your account
                            </span>
                        )}
                    </KeyValue>
                    <KeyValue label="Website">
                        {site.data ? (
                            <a
                                href={siblingUrl(null, user, "/")}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary inline-flex items-center gap-1 font-mono text-xs hover:underline"
                            >
                                {new URL(siblingUrl(null, user, "/")).host}
                                <ExternalLink className="size-3" />
                            </a>
                        ) : (
                            <span className="text-muted-foreground text-xs">
                                No site hosted on your account
                            </span>
                        )}
                    </KeyValue>
                    {isProducer && (
                        <KeyValue label="Block production">
                            <span className="text-xs">
                                You are one of{" "}
                                {producers.data?.producers.length ?? "—"} active
                                providers ·{" "}
                                <Link
                                    to="/providers"
                                    className="text-primary hover:underline"
                                >
                                    provider view
                                </Link>
                            </span>
                        </KeyValue>
                    )}
                </Panel>
            </div>

            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]">
                <Gauge className="size-3.5" />
                Activity is computed client-side from the rolling window of
                recent blocks.
                {status.resourcesAvailable
                    ? " Resource and token data is read directly from the network with your authorization."
                    : status.hasSystemToken
                      ? " Resource billing is not configured on this network."
                      : " This network has no system token, so resource and token panels are hidden."}
            </div>
        </div>
    );
};

const HeroSkeleton = () => (
    <div className="flex flex-col gap-4">
        <div className="grid-bg -mx-4 -mt-4 px-4 pb-2 pt-6 md:-mx-6 md:-mt-6 md:px-6">
            <div className="flex items-start gap-3">
                <Skeleton className="size-12 rounded-xl" />
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-3 w-40" />
                    <Skeleton className="h-8 w-64" />
                </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
            </div>
        </div>
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
    </div>
);
