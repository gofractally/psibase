import { useQuery } from "@tanstack/react-query";

import {
    fetchActivity,
    fetchCreditLines,
    fetchCurrencyPolicies,
    fetchObligations,
    fetchRoutingPolicies,
} from "@/lib/graphql";
import { QueryKey } from "@/lib/query-keys";

import { useCurrentUser } from "@shared/hooks/use-current-user";

export function useCreditLines() {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.creditLines(user),
        queryFn: () => fetchCreditLines(user!),
        enabled: !!user,
    });
}

export function useObligations() {
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
) {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.activity(user, counterparty ?? "", assetId ?? 0),
        queryFn: () => fetchActivity(user!, counterparty!, assetId!),
        enabled: !!user && !!counterparty && assetId !== undefined && enabled,
    });
}

export function useRoutingPolicies() {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.routingPolicies(user),
        queryFn: () => fetchRoutingPolicies(user!),
        enabled: !!user,
    });
}

export function useCurrencyPolicies() {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.currencyPolicies(user),
        queryFn: () => fetchCurrencyPolicies(user!),
        enabled: !!user,
    });
}
