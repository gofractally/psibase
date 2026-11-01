import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { ChevronLeft, ChevronRight, History, Loader2 } from "lucide-react";

import { NameEvent } from "@/apps/accounts-marketplace/lib/graphql/namemarket.schemas";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/page-header";
import { DataTable, THead, Table, Td, Th, Tr } from "@/components/table";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

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

function EventLabel({ action }: { action: string }) {
    const normalized = action.toLowerCase();
    const styles: Record<string, string> = {
        bought: "text-emerald-600 dark:text-emerald-400",
        claimed: "text-foreground",
    };
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium capitalize",
                styles[normalized] ?? "text-muted-foreground",
            )}
        >
            <span
                className={cn(
                    "size-1.5 rounded-full",
                    normalized === "bought"
                        ? "bg-emerald-500"
                        : normalized === "claimed"
                          ? "bg-[var(--chart-2)]"
                          : "bg-muted-foreground/50",
                )}
            />
            {action}
        </span>
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
    const showPagination =
        isLoggedIn &&
        !isPending &&
        !isError &&
        (hasNextPage || hasPreviousPage || pageIndex > 0);

    return (
        <Panel
            title="History"
            description="Purchases and claims for your account"
            className="max-w-4xl"
            actions={
                isFetching && !isPending ? (
                    <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
                ) : undefined
            }
        >
            {!isLoggedIn ? (
                <EmptyState className="min-h-32">
                    Log in to see your account marketplace history.
                </EmptyState>
            ) : isPending ? (
                <div className="flex flex-col gap-2 p-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-6 w-full" />
                    ))}
                </div>
            ) : isError ? (
                <EmptyState
                    className="text-destructive min-h-24"
                    detail={error?.message}
                >
                    Failed to load history
                </EmptyState>
            ) : events.length === 0 ? (
                <EmptyState
                    icon={History}
                    className="min-h-40"
                    detail={
                        pageIndex === 0
                            ? "Names you buy or claim will be listed here."
                            : "No more events."
                    }
                >
                    {pageIndex === 0 ? "No history yet" : "End of history"}
                </EmptyState>
            ) : (
                <DataTable>
                    <Table>
                        <THead>
                            <tr>
                                <Th className="w-28">Event</Th>
                                <Th>Account</Th>
                                <Th className="text-right">When</Th>
                            </tr>
                        </THead>
                        <tbody>
                            {events.map((event, index) => (
                                <Tr
                                    key={`${event.account}-${event.action}-${event.blockTime ?? index}`}
                                >
                                    <Td>
                                        <EventLabel action={event.action} />
                                    </Td>
                                    <Td>
                                        <span className="font-mono font-medium">
                                            {event.account}
                                        </span>
                                    </Td>
                                    <Td className="text-right">
                                        <time
                                            dateTime={event.blockTime}
                                            title={
                                                event.blockTime
                                                    ? dayjs(
                                                          event.blockTime,
                                                      ).format(
                                                          "MMMM D, YYYY h:mm:ss A",
                                                      )
                                                    : undefined
                                            }
                                            className="text-muted-foreground text-xs tabular-nums"
                                        >
                                            {formatEventTime(event.blockTime)}
                                        </time>
                                    </Td>
                                </Tr>
                            ))}
                        </tbody>
                    </Table>
                </DataTable>
            )}
            {showPagination && (
                <div className="bg-muted/30 flex items-center justify-between border-t px-4 py-2">
                    <span className="text-muted-foreground text-xs tabular-nums">
                        Page {pageIndex + 1}
                    </span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={onPreviousPage}
                            disabled={!hasPreviousPage || isFetching}
                        >
                            <ChevronLeft className="size-3.5" />
                            Previous
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={onNextPage}
                            disabled={!hasNextPage || isFetching}
                        >
                            Next
                            <ChevronRight className="size-3.5" />
                        </Button>
                    </div>
                </div>
            )}
        </Panel>
    );
}
