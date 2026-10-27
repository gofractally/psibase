import type { ReactNode } from "react";

import { ArrowUpRight } from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

import { StatCard } from "@/components/stat-card";

import {
    type ExplorerFeedStatus,
    useExplorerFeed,
    useGenesisTime,
} from "@/hooks/use-explorer-chain";
import {
    formatChainTime,
    formatDuration,
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
    children,
}: {
    path?: string;
    children: ReactNode;
}) => (
    <a
        href={siblingUrl(null, "explorer", path)}
        className="group block rounded-xl"
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

const StatCardSkeleton = () => (
    <div
        aria-busy
        className="bg-card/70 flex flex-col gap-2 rounded-xl border p-4 shadow-sm"
    >
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
    </div>
);

/** Explorer-backed chain stats; callers hide these when the Explorer package isn't installed. */
export const NetworkStats = ({ isPending = false }: { isPending?: boolean }) => (
    <div className="grid gap-4 sm:grid-cols-2">
        {isPending ? (
            <>
                <StatCardSkeleton />
                <StatCardSkeleton />
            </>
        ) : (
            <>
                <NetworkAgeCard />
                <ExplorerFeedCard />
            </>
        )}
    </div>
);
