import { type ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useMemo } from "react";

import { NameEvent } from "@/apps/prem-accounts/lib/graphql/prem-accounts.schemas";

import { Loading } from "@/components/loading";

import { DataTable } from "@shared/components/data-table";
import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { Badge } from "@shared/shadcn/ui/badge";
import {
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

dayjs.extend(relativeTime);

function formatEventTime(blockTime?: string): string {
    if (!blockTime) {
        return "—";
    }

    const date = dayjs(blockTime);
    if (!date.isValid()) {
        return "—";
    }

    if (dayjs().diff(date, "day") < 7) {
        return date.fromNow();
    }

    return date.format("MMM D, YYYY h:mm A");
}

function EventBadge({ action }: { action: string }) {
    const normalized = action.toLowerCase();

    if (normalized === "bought") {
        return (
            <Badge
                variant="outline"
                className="border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
                Bought
            </Badge>
        );
    }

    if (normalized === "claimed") {
        return (
            <Badge
                variant="outline"
                className="border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/40 dark:bg-sky-950/40 dark:text-sky-300"
            >
                Claimed
            </Badge>
        );
    }

    return (
        <Badge variant="secondary" className="capitalize">
            {action}
        </Badge>
    );
}

type Props = {
    events: NameEvent[];
    pageIndex: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    onNextPage: () => void;
    onPreviousPage: () => void;
    isPending: boolean;
    isFetching: boolean;
    isError: boolean;
    error: Error | null;
    isLoggedIn: boolean;
};

export function HistorySection({
    events,
    pageIndex,
    hasNextPage,
    hasPreviousPage,
    onNextPage,
    onPreviousPage,
    isPending,
    isFetching,
    isError,
    error,
    isLoggedIn,
}: Props) {
    const columns = useMemo<ColumnDef<NameEvent>[]>(
        () => [
            {
                accessorKey: "action",
                header: "Event",
                meta: { className: "w-32 whitespace-nowrap pr-3" },
                cell: ({ row }) => <EventBadge action={row.original.action} />,
            },
            {
                accessorKey: "account",
                header: "Account",
                cell: ({ row }) => (
                    <span className="font-mono text-sm font-medium">
                        {row.original.account}
                    </span>
                ),
            },
            {
                accessorKey: "blockTime",
                header: () => <div className="text-right">Date</div>,
                cell: ({ row }) => {
                    const { blockTime } = row.original;
                    const formatted = formatEventTime(blockTime);

                    return (
                        <div className="text-right">
                            <time
                                dateTime={blockTime}
                                title={
                                    blockTime
                                        ? dayjs(blockTime).format(
                                              "MMMM D, YYYY h:mm:ss A",
                                          )
                                        : undefined
                                }
                                className="text-muted-foreground text-sm"
                            >
                                {formatted}
                            </time>
                        </div>
                    );
                },
            },
        ],
        [],
    );

    if (!isLoggedIn) {
        return (
            <GlowingCard>
                <CardContent className="text-muted-foreground py-8 text-center">
                    Log in to see your account marketplace history.
                </CardContent>
            </GlowingCard>
        );
    }

    if (isPending) {
        return (
            <GlowingCard>
                <Loading />
            </GlowingCard>
        );
    }

    if (isError) {
        return (
            <GlowingCard>
                <ErrorCard
                    error={
                        error ??
                        new Error("Failed to load account marketplace history.")
                    }
                />
            </GlowingCard>
        );
    }

    if (events.length === 0 && pageIndex === 0) {
        return (
            <GlowingCard>
                <CardHeader>
                    <CardTitle>History</CardTitle>
                    <CardDescription>
                        Purchases and claims appear here.
                    </CardDescription>
                </CardHeader>
                <CardContent className="text-muted-foreground py-8 text-center">
                    You don&apos;t have any history yet.
                </CardContent>
            </GlowingCard>
        );
    }

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>History</CardTitle>
                <CardDescription>
                    Purchases and claims for your account.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <DataTable
                    columns={columns}
                    data={events}
                    caption="Your account marketplace activity."
                    emptyMessage="You don't have any history yet."
                    serverPagination={{
                        pageIndex,
                        hasNextPage,
                        hasPreviousPage,
                        onNextPage,
                        onPreviousPage,
                        isLoading: isFetching,
                    }}
                />
            </CardContent>
        </GlowingCard>
    );
}
