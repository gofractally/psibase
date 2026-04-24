import { useEffect, useState } from "react";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { graphql } from "@shared/lib/graphql";

import { zNameEventsPageData } from "@/lib/graphql/prem-accounts.schemas";
import { PREM_ACCOUNTS_SERVICE } from "@/lib/prem-service";

type Props = {
    /** Increment (e.g. after a purchase) to refetch history while logged in. */
    historyNonce?: number;
};

const PAGE_SIZE = 20;

export function HistorySection({ historyNonce = 0 }: Props) {
    const { data: loggedInUser } = useCurrentUser();
    const [historyEvents, setHistoryEvents] = useState<
        { account: string; action: string }[]
    >([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [historyError, setHistoryError] = useState("");
    const [currentPage, setCurrentPage] = useState(1);

    useEffect(() => {
        if (!loggedInUser) {
            setHistoryEvents([]);
            setHistoryError("");
            setIsLoadingHistory(false);
            return;
        }

        const loadHistoryEvents = async () => {
            setIsLoadingHistory(true);
            setHistoryError("");

            try {
                const allEvents: { account: string; action: string }[] = [];
                let hasNextPage = true;
                let afterCursor: string | null = null;

                while (hasNextPage) {
                    const page = zNameEventsPageData.parse(
                        await graphql(
                            `
                                query NameEvents(
                                    $owner: String!,
                                    $first: Int,
                                    $after: String
                                ) {
                                    nameEvents(
                                        owner: $owner,
                                        first: $first,
                                        after: $after
                                    ) {
                                        edges {
                                            node {
                                                account
                                                action
                                            }
                                        }
                                        pageInfo {
                                            hasNextPage
                                            endCursor
                                        }
                                    }
                                }
                            `,
                            {
                                service: PREM_ACCOUNTS_SERVICE,
                                variables: {
                                    owner: loggedInUser,
                                    first: 50,
                                    after: afterCursor,
                                },
                            },
                        ),
                    );
                    const connection = page.nameEvents;
                    if (!connection) {
                        break;
                    }

                    for (const edge of connection.edges) {
                        const node = edge.node;
                        if (node) {
                            allEvents.push({
                                account: node.account,
                                action: node.action,
                            });
                        }
                    }

                    hasNextPage = connection.pageInfo?.hasNextPage ?? false;
                    afterCursor = connection.pageInfo?.endCursor ?? null;
                }

                setHistoryEvents(allEvents);
                setCurrentPage((p) => {
                    const totalPages = Math.max(
                        1,
                        Math.ceil(allEvents.length / PAGE_SIZE),
                    );
                    return Math.min(Math.max(1, p), totalPages);
                });
            } catch (e) {
                console.error("Failed to load history events:", e);
                setHistoryEvents((prev) =>
                    prev.length > 0 ? prev : [],
                );
                setHistoryError(
                    e instanceof Error
                        ? e.message
                        : "Failed to load history events",
                );
            } finally {
                setIsLoadingHistory(false);
            }
        };

        void loadHistoryEvents();
    }, [loggedInUser, historyNonce]);

    const showBlockingHistoryLoad =
        isLoadingHistory && historyEvents.length === 0;

    return (
        <div className="mt-8">
            <h2 className="mb-3 text-lg font-semibold">History</h2>
            {!loggedInUser ? (
                <p className="text-gray-500">
                    Log in to see your premium account history.
                </p>
            ) : showBlockingHistoryLoad ? (
                <p className="text-gray-500">Loading history...</p>
            ) : historyError && historyEvents.length === 0 ? (
                <p className="text-red-500">{historyError}</p>
            ) : historyEvents.length === 0 ? (
                <p className="text-gray-500">
                    You don&apos;t have any history yet.
                </p>
            ) : (
                (() => {
                    const totalPages = Math.ceil(
                        historyEvents.length / PAGE_SIZE,
                    );
                    const pageEvents = historyEvents.slice(
                        (currentPage - 1) * PAGE_SIZE,
                        currentPage * PAGE_SIZE,
                    );
                    return (
                        <div className="space-y-3">
                            {historyError ? (
                                <p className="text-destructive text-sm">
                                    Couldn&apos;t refresh history:{" "}
                                    {historyError}
                                </p>
                            ) : null}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between text-sm">
                                    <button
                                        onClick={() =>
                                            setCurrentPage((p: number) =>
                                                Math.max(1, p - 1),
                                            )
                                        }
                                        disabled={currentPage === 1}
                                        className="rounded-md border px-3 py-1 disabled:opacity-40 enabled:hover:bg-muted"
                                    >
                                        Previous
                                    </button>
                                    <span className="text-muted-foreground">
                                        Page {currentPage} of {totalPages}
                                    </span>
                                    <button
                                        onClick={() =>
                                            setCurrentPage((p: number) =>
                                                Math.min(totalPages, p + 1),
                                            )
                                        }
                                        disabled={currentPage === totalPages}
                                        className="rounded-md border px-3 py-1 disabled:opacity-40 enabled:hover:bg-muted"
                                    >
                                        Next
                                    </button>
                                </div>
                            )}
                            <div className="overflow-hidden rounded-md border">
                                <div className="bg-muted text-muted-foreground grid grid-cols-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide">
                                    <div>Account</div>
                                    <div>Event</div>
                                </div>
                                <ul>
                                    {pageEvents.map((event, index) => (
                                        <li
                                            key={`${event.account}-${event.action}-${(currentPage - 1) * PAGE_SIZE + index}`}
                                            className="grid grid-cols-2 border-t px-4 py-2 text-sm last:border-b-0"
                                        >
                                            <span className="font-mono">
                                                {event.account}
                                            </span>
                                            <span className="capitalize">
                                                {event.action}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    );
                })()
            )}
        </div>
    );
}
