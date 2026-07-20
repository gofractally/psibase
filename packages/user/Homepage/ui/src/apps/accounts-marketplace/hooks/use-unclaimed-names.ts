import { useQuery } from "@tanstack/react-query";

import { fetchAllUnclaimedNames } from "@/apps/accounts-marketplace/lib/graphql/namemarket-api";

import QueryKey from "@/lib/query-keys";

import { Account } from "@shared/lib/schemas/account";

export const useUnclaimedNames = (user?: Account | null) =>
    useQuery({
        queryKey: QueryKey.nameMarketUnclaimedNames(user),
        queryFn: fetchAllUnclaimedNames,
        enabled: !!user,
    });
