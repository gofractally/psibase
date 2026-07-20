import { useQuery } from "@tanstack/react-query";

import {
    type FetchNameEventsPageParams,
    fetchNameEventsPage,
} from "@/apps/accounts-marketplace/lib/graphql/namemarket-api";

import QueryKey from "@/lib/query-keys";

import { Account } from "@shared/lib/schemas/account";

type UseNameEventsOptions = FetchNameEventsPageParams & {
    enabled?: boolean;
};

export const useNameEvents = (
    user: Account | null | undefined,
    options: UseNameEventsOptions,
) => {
    const { enabled = true, ...params } = options;

    return useQuery({
        queryKey: QueryKey.nameMarketEvents(user, params),
        queryFn: () => fetchNameEventsPage(params),
        enabled: !!user && enabled,
    });
};
