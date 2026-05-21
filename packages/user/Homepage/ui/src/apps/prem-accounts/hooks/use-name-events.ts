import { useQuery } from "@tanstack/react-query";

import { fetchAllNameEvents } from "@/apps/prem-accounts/lib/graphql/prem-accounts-api";
import QueryKey from "@/lib/query-keys";

import { Account } from "@shared/lib/schemas/account";

export const useNameEvents = (user?: Account | null) =>
    useQuery({
        queryKey: QueryKey.premNameEvents(user),
        queryFn: () => fetchAllNameEvents(user!),
        enabled: !!user,
    });
