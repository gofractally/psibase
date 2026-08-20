import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
    fetchActivity,
    fetchCreditLines,
    fetchCurrencyPolicies,
    fetchObligations,
    fetchForwardOffers,
    fetchRequests,
    fetchClaimOffers,
    type ActivityEvent,
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
