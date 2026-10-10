import type { QueryOptions } from "@shared/hooks/types";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { callLoginPrompt } from "../lib/login-prompt";
import QueryKey from "../lib/query-keys";

export const queryGetAllAccounts = queryOptions({
    queryKey: QueryKey.getAllAccounts(),
    queryFn: async () => {
        const res = await callLoginPrompt("admin", "getAllAccounts", []);
        return z.string().array().parse(res);
    },
});

export const useGetAllAccounts = (
    options?: QueryOptions<
        string[],
        Error,
        string[],
        ReturnType<typeof QueryKey.getAllAccounts>
    >,
) => {
    const queryOptions = options ?? {};
    return useQuery({ ...queryGetAllAccounts, ...queryOptions });
};
