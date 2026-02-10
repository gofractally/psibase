import { QueryOptions, queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "../lib/query-keys";
import { Account, zAccount } from "../lib/schemas/account";
import { supervisor } from "../lib/supervisor";
import { queryClient } from "../lib/queryClient";

export type GetCurrentUserRes = string | null;

export const queryCurrentUser = queryOptions({
    queryKey: QueryKey.currentUser(),
    queryFn: async (): Promise<GetCurrentUserRes> => {
        const res = await supervisor.functionCall({
            method: "getCurrentUser",
            params: [],
            service: "accounts",
            intf: "api",
        });
        return res ? zAccount.parse(res) : null;
    },
    staleTime: 60000,
});

export const useCurrentUser = (
    options?: QueryOptions<
        GetCurrentUserRes,
        Error,
        GetCurrentUserRes,
        ReturnType<typeof QueryKey.currentUser>
    >,
) => {
    const queryOptions = options ?? {};
    return useQuery({ ...queryCurrentUser, ...queryOptions });
};

export const assertUser = (): Account =>
    zAccount.parse(queryClient.getQueryData(QueryKey.currentUser()));

export const getCurrentUser = (): string | null => {
    const res = queryClient.getQueryData(QueryKey.currentUser());
    return res ? z.string().parse(res) : null;
};
