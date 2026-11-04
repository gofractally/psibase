import { liveChain } from "@/store/live-chain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useCurrentUser } from "@shared/hooks/use-current-user";

/** Query keys whose results come from the explorer's redacted block log. */
const BLOCK_LOG_QUERY_KEYS = new Set([
    "block",
    "blocks",
    "transaction",
    "search",
]);

/**
 * The explorer service redacts transactions the logged-in user is not a party
 * to, so anything fetched from the block log must be refetched when the user
 * logs in, logs out, or switches accounts.
 */
export const useViewerSync = () => {
    const { data: currentUser } = useCurrentUser();
    const queryClient = useQueryClient();
    const previous = useRef<string | null | undefined>(undefined);

    useEffect(() => {
        if (currentUser === undefined) return;
        liveChain.setViewer(currentUser);
        if (
            previous.current !== undefined &&
            previous.current !== currentUser
        ) {
            void queryClient.resetQueries({
                predicate: (query) =>
                    BLOCK_LOG_QUERY_KEYS.has(String(query.queryKey[0])),
            });
        }
        previous.current = currentUser;
    }, [currentUser, queryClient]);

    return currentUser;
};
