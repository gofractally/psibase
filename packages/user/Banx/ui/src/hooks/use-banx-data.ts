import { useMemo } from "react";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
    fetchActivity,
    fetchCashQuotes,
    fetchCashVault,
    fetchCreditLines,
    fetchCurrencyPolicies,
    fetchObligations,
    fetchForwardOffers,
    fetchRequests,
    fetchClaimOffers,
    fetchTokenPrecision,
    type ActivityEvent,
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

export function useCreditLines(): UseQueryResult<CreditLine[], Error> {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.creditLines(user),
        queryFn: () => fetchCreditLines(user!),
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

export function useTokenPrecisionMap(tokenIds: number[]): Map<number, number> {
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
        const m = new Map<number, number>();
        unique.forEach((id, i) => {
            const v = queries[i]?.data;
            if (typeof v === "number") m.set(id, v);
        });
        return m;
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
