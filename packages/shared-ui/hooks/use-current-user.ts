import type { UndefinedInitialDataOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "../lib/query-keys";
import { queryClient as defaultQueryClient } from "../lib/queryClient";
import { Account, zAccount } from "../lib/schemas/account";
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
    options?: Omit<UndefinedInitialDataOptions<
        string | null,
        Error,
        GetCurrentUserRes,
        ReturnType<typeof QueryKey.currentUser>
    >, "queryKey" | "queryFn">,
) => {
    const queryOptions = options ?? {};
    return useQuery({ ...queryCurrentUser, ...queryOptions });
};

export const assertUser = (
    queryClient: QueryClient = defaultQueryClient,
): Account => zAccount.parse(queryClient.getQueryData(QueryKey.currentUser()));

export const getCurrentUser = (
    queryClient: QueryClient = defaultQueryClient,
): string | null => {
    const res = queryClient.getQueryData(QueryKey.currentUser());
    return res ? z.string().parse(res) : null;
};
