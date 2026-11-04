import { Activity } from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/page-header";

import { useServiceActivity } from "@/hooks/use-explorer-chain";
import { colorFor } from "@/lib/colors";
import { formatMinutes } from "@/lib/format";

import { Avatar } from "@shared/components/avatar";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const TOP = 8;
const SKELETON_ROWS = 5;

const RowSkeletons = () =>
    Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-1.5">
            <Skeleton className="h-3 w-4" />
            <Skeleton className="size-6 rounded-full" />
            <span className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-1 w-full" />
            </span>
            <Skeleton className="h-3 w-8" />
        </div>
    ));

const DEFAULT_DESCRIPTION = "Actions received recently";

export const MostActiveAppsSkeleton = () => (
    <Panel
        title="Most active apps"
        description={DEFAULT_DESCRIPTION}
        bodyClassName="p-2"
    >
        <RowSkeletons />
    </Panel>
);

/** Services ranked by actions received across the recent block window. */
export const MostActiveApps = () => {
    const { data, isPending, isError } = useServiceActivity();
    const top = data?.services.slice(0, TOP) ?? [];
    const max = top[0]?.count ?? 0;

    return (
        <Panel
            title="Most active apps"
            description={
                data && data.windowBlocks > 0
                    ? `Actions received in the last ${formatMinutes(data.windowSeconds)}, excluding system actions`
                    : DEFAULT_DESCRIPTION
            }
            bodyClassName="p-2"
        >
            {isPending ? (
                <RowSkeletons />
            ) : isError ? (
                <EmptyState icon={Activity}>
                    Couldn't load recent activity
                </EmptyState>
            ) : top.length === 0 ? (
                <EmptyState icon={Activity}>
                    {data.windowBlocks > 0
                        ? `No app activity in the last ${formatMinutes(data.windowSeconds)}`
                        : "No recent app activity"}
                </EmptyState>
            ) : (
                <ol className="flex flex-col">
                    {top.map(({ service, count }, i) => (
                        <li key={service}>
                            <a
                                href={siblingUrl(
                                    null,
                                    "explorer",
                                    `/accounts/${service}`,
                                )}
                                className="hover:bg-accent/40 flex items-center gap-3 rounded-md px-2 py-1.5"
                            >
                                <span className="text-muted-foreground w-4 shrink-0 text-right font-mono text-[10px]">
                                    {i + 1}
                                </span>
                                <Avatar
                                    account={service}
                                    className="size-6 shrink-0 border"
                                    alt=""
                                />
                                <span className="flex min-w-0 flex-1 flex-col gap-1">
                                    <span className="truncate text-sm font-medium">
                                        {service}
                                    </span>
                                    <span className="bg-muted h-1 overflow-hidden rounded-full">
                                        <span
                                            className="block h-full rounded-full"
                                            style={{
                                                width: `${(count / max) * 100}%`,
                                                backgroundColor:
                                                    colorFor(service),
                                            }}
                                        />
                                    </span>
                                </span>
                                <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                                    {count.toLocaleString()}
                                </span>
                            </a>
                        </li>
                    ))}
                </ol>
            )}
        </Panel>
    );
};
