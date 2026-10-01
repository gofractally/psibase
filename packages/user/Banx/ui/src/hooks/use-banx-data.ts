import { useMemo } from "react";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
    fetchActivity,
    fetchActivityFeed,
    fetchActivityWith,
    fetchBookAuths,
    fetchCashQuotes,
    fetchCashVault,
    fetchCreditLines,
    fetchNetworkLines,
    fetchCurrencyPolicies,
    fetchObligations,
    fetchForwardOffers,
    fetchRequests,
    fetchClaimOffers,
    fetchInvites,
    fetchTokenPrecision,
    type ActivityEvent,
    type BanxInvite,
    type BookAuth,
    type CashQuote,
    type CashVault,
    type ClaimOffer,
    type CreditLine,
    type CurrencyPolicy,
    type ForwardOffer,
    type Obligation,
    type PayRequest,
} from "@/lib/graphql";
import { QueryKey } from "@/lib/query-keys";

import { useCurrentUser } from "@shared/hooks/use-current-user";

export function useBookAuths(): UseQueryResult<BookAuth[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.bookAuths(user),
        queryFn: () => fetchBookAuths(user!),
        enabled: !!user,
    });
}

export function useCreditLines(): UseQueryResult<CreditLine[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.creditLines(user),
        queryFn: () => fetchCreditLines(user!),
        enabled: !!user,
    });
}

export function useNetworkLines(): UseQueryResult<CreditLine[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.networkLines(),
        queryFn: fetchNetworkLines,
        enabled: !!user,
    });
}

export function useObligations(): UseQueryResult<Obligation[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.obligations(user),
        queryFn: () => fetchObligations(user!),
        enabled: !!user,
    });
}

export function useActivity(
    counterparty: string | undefined,
    assetId: number | undefined,
    enabled: boolean,
): UseQueryResult<ActivityEvent[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.activity(user, counterparty ?? "", assetId ?? 0),
        queryFn: () => fetchActivity(user!, counterparty!, assetId!),
        enabled: !!user && !!counterparty && assetId !== undefined && enabled,
    });
}

export function useActivityWith(
    counterparty: string | undefined,
): UseQueryResult<ActivityEvent[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.activityWith(user, counterparty ?? ""),
        queryFn: () => fetchActivityWith(user!, counterparty!),
        enabled: !!user && !!counterparty,
        refetchInterval: 15_000,
    });
}

export function useActivityFeed(): UseQueryResult<ActivityEvent[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.activityFeed(user),
        queryFn: () => fetchActivityFeed(user!),
        enabled: !!user,
        refetchInterval: 15_000,
    });
}

export function useForwardOffers(): UseQueryResult<ForwardOffer[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.forwardOffers(user),
        queryFn: () => fetchForwardOffers(user!),
        enabled: !!user,
    });
}

export function useClaimOffers(): UseQueryResult<ClaimOffer[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.claimOffers(user),
        queryFn: () => fetchClaimOffers(user!),
        enabled: !!user,
    });
}

export function useBuyClaimOffers() {
    return useClaimOffers();
}

export function useInvites(): UseQueryResult<BanxInvite[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.invites(user),
        queryFn: () => fetchInvites(user!),
        enabled: !!user,
    });
}

export function useRequests(): UseQueryResult<PayRequest[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.requests(user),
        queryFn: () => fetchRequests(user!),
        enabled: !!user,
    });
}

export function useCashQuotes(
    poster?: string | null,
): UseQueryResult<CashQuote[], Error> {
    const all = poster === undefined;
    const key = all ? "*" : (poster ?? "");
    return useQuery({
        queryKey: QueryKey.cashQuotes(key),
        queryFn: () => fetchCashQuotes(all ? undefined : poster ?? undefined),
        enabled: all || !!poster?.trim(),
    });
}

export function useCashVault(): UseQueryResult<CashVault[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.cashVault(user),
        queryFn: () => fetchCashVault(user!),
        enabled: !!user,
    });
}

export function useTokenPrecision(
    tokenId: number | undefined,
): UseQueryResult<number, Error> {
    return useQuery({
        queryKey: QueryKey.tokenPrecision(tokenId ?? 0),
        queryFn: () => fetchTokenPrecision(tokenId!),
        enabled: tokenId !== undefined && tokenId > 0,
        staleTime: 60_000,
    });
}

export function useTokenPrecisionMap(tokenIds: number[]): {
    precision: Map<number, number>;
    pending: ReadonlySet<number>;
    failed: ReadonlySet<number>;
} {
    const tokenKey = [...new Set(tokenIds.filter((id) => id > 0))]
        .sort((a, b) => a - b)
        .join(",");
    const unique = useMemo(
        () => (tokenKey ? tokenKey.split(",").map(Number) : []),
        [tokenKey],
    );
    const queries = useQueries({
        queries: unique.map((id) => ({
            queryKey: QueryKey.tokenPrecision(id),
            queryFn: () => fetchTokenPrecision(id),
            staleTime: 60_000,
        })),
    });
    return useMemo(() => {
        const precision = new Map<number, number>();
        const pending = new Set<number>();
        const failed = new Set<number>();
        unique.forEach((id, i) => {
            const query = queries[i];
            const value = query?.data;
            if (typeof value === "number") precision.set(id, value);
            else if (query?.isError) failed.add(id);
            else pending.add(id);
        });
        return { precision, pending, failed };
    }, [queries, unique]);
}

export function useCurrencyPolicies(): UseQueryResult<
    CurrencyPolicy[],
    Error
> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.currencyPolicies(user),
        queryFn: () => fetchCurrencyPolicies(user!),
        enabled: !!user,
    });
}
