import type { QueryOptions } from "@shared/hooks/types";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import QueryKey from "../lib/queryKeys";

const supervisor = getSupervisor();

export const queryCanCreateAccount = queryOptions({
    queryKey: QueryKey.canCreateAccount(),
    queryFn: async () => {
        const res = await supervisor.functionCall({
            service: "accounts",
            plugin: "plugin",
            intf: "prompt",
            method: "canCreateAccount",
            params: [],
        });
        return z.boolean().parse(res);
    },
});

export const useCanCreateAccount = (
    options?: QueryOptions<
        boolean,
        Error,
        boolean,
        ReturnType<typeof QueryKey.canCreateAccount>
    >,
) => {
    const queryOptions = options ?? {};
    return useQuery({ ...queryCanCreateAccount, ...queryOptions });
};

