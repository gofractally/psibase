import type { ReactNode } from "react";

import { ArrowUpRight } from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

import { StatCard } from "@/components/stat-card";

import {
    type ExplorerFeedStatus,
    useExplorerFeed,
    useGenesisTime,
    useUserActivity,
} from "@/hooks/use-explorer-chain";
import {
    formatChainTime,
    formatDuration,
    formatMinutes,
    formatSecondsAgo,
    parseChainTime,
} from "@/lib/format";

import { useNowUnix } from "@shared/hooks/use-now-unix";
import { cn } from "@shared/lib/utils";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const STATUS_DOT: Record<
    ExplorerFeedStatus,
    { color: string; ring: string; pulse: boolean }
> = {
    connecting: { color: "bg-amber-400", ring: "bg-amber-400/40", pulse: true },
    live: { color: "bg-emerald-500", ring: "bg-emerald-500/40", pulse: true },
    stalled: { color: "bg-amber-500", ring: "bg-amber-500/40", pulse: false },
    error: { color: "bg-rose-500", ring: "bg-rose-500/40", pulse: false },
};

const StatusDot = ({ status }: { status: ExplorerFeedStatus }) => {
    const s = STATUS_DOT[status];
    return (
        <span className="relative inline-flex size-2.5">
            {s.pulse && (
                <span
                    className={cn(
                        "absolute inline-flex h-full w-full animate-ping rounded-full",
                        s.ring,
                    )}
                />
            )}
            <span
                className={cn(
                    "relative inline-flex size-2.5 rounded-full",
                    s.color,
                )}
            />
        </span>
    );
};

const ExplorerLink = ({
    path,
    className,
    children,
}: {
    path?: string;
    className?: string;
    children: ReactNode;
}) => (
    <a
        href={siblingUrl(null, "explorer", path)}
        className={cn("group block rounded-xl", className)}
    >
        {children}
    </a>
);

const linkedCardClass =
    "h-full transition-colors group-hover:bg-accent/40 group-hover:border-foreground/20";

const NetworkAgeCard = () => {
    const now = useNowUnix();
    const { data: genesisTime, isPending } = useGenesisTime();
    const genesisSeconds = genesisTime
        ? parseChainTime(genesisTime).getTime() / 1000
        : null;

    return (
        <ExplorerLink path="/network">
            <StatCard
                label="Network age"
                icon={ArrowUpRight}
                accent="var(--chart-2)"
                className={linkedCardClass}
                value={
                    genesisSeconds !== null
                        ? formatDuration(now - genesisSeconds)
                        : "—"
                }
                sub={
                    genesisTime
                        ? `since ${formatChainTime(genesisTime)}`
                        : isPending
                          ? "loading…"
                          : "unavailable"
                }
            />
        </ExplorerLink>
    );
};

const ExplorerFeedCard = () => {
    const now = useNowUnix();
    const { status, lastPollAt } = useExplorerFeed();

    return (
        <ExplorerLink>
            <StatCard
                label="Explorer feed"
                icon={ArrowUpRight}
                accent={
                    status === "live" ? "var(--chart-2)" : "var(--destructive)"
                }
                className={linkedCardClass}
                value={
                    <span className="flex items-center gap-2 capitalize">
                        <StatusDot status={status} /> {status}
                    </span>
                }
                sub={
                    lastPollAt
                        ? `polled ${formatSecondsAgo(Math.max(0, now - lastPollAt / 1000))}`
                        : "…"
                }
            />
        </ExplorerLink>
    );
};

const UserActivityCard = ({
    user,
    className,
}: {
    user: string;
    className?: string;
}) => {
    const { data, isPending, isError } = useUserActivity(user);

    return (
        <ExplorerLink path="/me" className={className}>
            <StatCard
                label="Your activity"
                icon={ArrowUpRight}
                accent="var(--chart-2)"
                className={linkedCardClass}
                value={
                    data ? (
                        data.actionsSent.toLocaleString()
                    ) : isPending ? (
                        <Skeleton className="h-7 w-16" />
                    ) : (
                        <span className="text-muted-foreground text-base">
                            unavailable
                        </span>
                    )
                }
                sub={
                    data
                        ? data.windowBlocks > 0
                            ? `actions sent in the last ${formatMinutes(data.windowSeconds)}`
                            : "actions sent recently"
                        : isError
                          ? "couldn't load recent activity"
                          : "loading…"
                }
                spark={data?.spark}
            />
        </ExplorerLink>
    );
};

const StatCardSkeleton = ({ className }: { className?: string }) => (
    <div
        aria-busy
        className={cn(
            "bg-card/70 flex flex-col gap-2 rounded-xl border p-4 shadow-sm",
            className,
        )}
    >
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
    </div>
);

/**
 * Explorer-backed chain stats, plus the user's own activity when signed in;
 * callers hide these when the Explorer package isn't installed.
 */
export const NetworkStats = ({
    user,
    isPending = false,
}: {
    user?: string | null;
    isPending?: boolean;
}) => (
    <div className="grid gap-4 sm:grid-cols-2">
        {isPending ? (
            <>
                <StatCardSkeleton />
                <StatCardSkeleton />
                {user && <StatCardSkeleton className="sm:col-span-2" />}
            </>
        ) : (
            <>
                <NetworkAgeCard />
                <ExplorerFeedCard />
                {user && (
                    <UserActivityCard user={user} className="sm:col-span-2" />
                )}
            </>
        )}
    </div>
);
