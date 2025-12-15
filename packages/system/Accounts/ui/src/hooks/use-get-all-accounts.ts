import type { QueryOptions } from "@shared/hooks/types";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import QueryKey from "../lib/queryKeys";

const supervisor = getSupervisor();

export const queryGetAllAccounts = queryOptions({
    queryKey: QueryKey.getAllAccounts(),
    queryFn: async () => {
        const res = await supervisor.functionCall({
            service: "accounts",
            plugin: "plugin",
            intf: "admin",
            method: "getAllAccounts",
            params: [],
        });
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

