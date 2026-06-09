import { useQuery } from "@tanstack/react-query";

import {
    fetchNameEventsPage,
    type FetchNameEventsPageParams,
} from "@/apps/prem-accounts/lib/graphql/prem-accounts-api";

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
        queryKey: QueryKey.premNameEvents(user, params),
        queryFn: () => fetchNameEventsPage(user!, params),
        enabled: !!user && enabled,
    });
};
