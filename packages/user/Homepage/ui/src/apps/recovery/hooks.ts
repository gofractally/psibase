import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { toast } from "@shared/shadcn/ui/sonner";

import {
    type PartnerDecision,
    fetchIsPartner,
    fetchPartnerAccounts,
    fetchPartnerRequests,
    sendDecision,
} from "./api";

const key = {
    all: (user?: string | null) => ["recoveryPartner", user] as const,
    isPartner: (user?: string | null) =>
        ["recoveryPartner", user, "isPartner"] as const,
    accounts: (user?: string | null, prefix = "") =>
        ["recoveryPartner", user, "accounts", prefix] as const,
    requests: (user?: string | null) =>
        ["recoveryPartner", user, "requests"] as const,
};

/** Whether to offer the recovery page: the user is someone's recovery partner. */
export const useIsRecoveryPartner = () => {
    const { data: user } = useCurrentUser();
    const { data } = useQuery({
        queryKey: key.isPartner(user),
        queryFn: () => fetchIsPartner(user!),
        enabled: !!user,
        staleTime: 60_000,
    });
    return data === true;
};

/**
 * The accounts the user is partner for, a page at a time. With a prefix the
 * list starts at the first name that matches and stops at the first that
 * does not.
 */
export const usePartnerAccounts = (prefix: string) => {
    const { data: user } = useCurrentUser();
    return useInfiniteQuery({
        queryKey: key.accounts(user, prefix),
        enabled: !!user,
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam }) => {
            const page = await fetchPartnerAccounts(user!, {
                after: pageParam,
                prefix: prefix || undefined,
            });
            if (!prefix) return page;
            const matching = page.accounts.filter((a) =>
                a.account.startsWith(prefix),
            );
            return {
                ...page,
                accounts: matching,
                hasNextPage:
                    page.hasNextPage && matching.length === page.accounts.length,
            };
        },
        getNextPageParam: (last) =>
            last.hasNextPage ? last.endCursor : undefined,
    });
};

/** What is waiting for the user's decision. Refreshed while the page is open. */
export const usePartnerRequests = () => {
    const { data: user } = useCurrentUser();
    return useInfiniteQuery({
        queryKey: key.requests(user),
        enabled: !!user,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => fetchPartnerRequests(user!, pageParam),
        getNextPageParam: (last) =>
            last.hasNextPage ? last.endCursor : undefined,
        refetchInterval: 15_000,
    });
};

const done: Record<PartnerDecision["kind"], string> = {
    confirm: "Change approved",
    reject: "Change rejected",
    endPause: "Pause ended",
    unfreeze: "Account released with its new keys",
    rejectRecovery: "Request rejected",
};

export const usePartnerDecision = () => {
    const { data: user } = useCurrentUser();
    const client = useQueryClient();
    return useMutation({
        mutationFn: sendDecision,
        onSuccess: (_data, decision) => {
            toast.success(`${done[decision.kind]}: ${decision.account}`);
        },
        onError: (error, decision) => {
            toast.error(`${decision.account}: ${error.message}`);
        },
        onSettled: () =>
            // Queries can trail the transaction by a block.
            setTimeout(
                () => client.invalidateQueries({ queryKey: key.all(user) }),
                1200,
            ),
    });
};
