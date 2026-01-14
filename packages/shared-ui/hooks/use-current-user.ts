import { QueryOptions, queryOptions, useQuery } from "@tanstack/react-query";

import QueryKey from "../lib/query-keys";
import { zAccount } from "../lib/schemas/account";
import { supervisor } from "../lib/supervisor";

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
