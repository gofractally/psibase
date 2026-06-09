import { useCallback, useEffect, useState } from "react";

import { useNameEvents } from "@/apps/prem-accounts/hooks/use-name-events";
import { NAME_EVENTS_HISTORY_PAGE_SIZE } from "@/apps/prem-accounts/lib/graphql/prem-accounts-api";

import { Account } from "@shared/lib/schemas/account";

export const usePaginatedNameEvents = (user?: Account | null) => {
    const [pageIndex, setPageIndex] = useState(0);
    const [pageBeforeCursors, setPageBeforeCursors] = useState<
        (string | undefined)[]
    >([undefined]);

    useEffect(() => {
        setPageIndex(0);
        setPageBeforeCursors([undefined]);
    }, [user]);

    const before = pageBeforeCursors[pageIndex];

    const { data, isPending, isFetching, isError, error } = useNameEvents(
        user,
        {
            last: NAME_EVENTS_HISTORY_PAGE_SIZE,
            before,
            enabled: !!user,
        },
    );

    const goNext = useCallback(() => {
        const oldestCursor = data?.pageInfo.oldestCursor;
        if (!data?.pageInfo.hasPreviousPage || !oldestCursor) {
            return;
        }

        setPageBeforeCursors((prev) => {
            const next = [...prev];
            next[pageIndex + 1] = oldestCursor;
            return next;
        });
        setPageIndex((prev) => prev + 1);
    }, [data, pageIndex]);

    const goPrevious = useCallback(() => {
        setPageIndex((prev) => Math.max(0, prev - 1));
    }, []);

    return {
        events: data?.events ?? [],
        pageIndex,
        hasNextPage: data?.pageInfo.hasPreviousPage ?? false,
        hasPreviousPage: pageIndex > 0,
        goNext,
        goPrevious,
        isPending: !!user && isPending,
        isFetching,
        isError,
        error,
    };
};
