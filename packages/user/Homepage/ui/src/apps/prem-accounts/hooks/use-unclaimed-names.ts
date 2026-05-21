import { useQuery } from "@tanstack/react-query";

import { fetchAllUnclaimedNames } from "@/apps/prem-accounts/lib/graphql/prem-accounts-api";
import QueryKey from "@/lib/query-keys";

import { Account } from "@shared/lib/schemas/account";

export const useUnclaimedNames = (user?: Account | null) =>
    useQuery({
        queryKey: QueryKey.premUnclaimedNames(user),
        queryFn: fetchAllUnclaimedNames,
        enabled: !!user,
    });
