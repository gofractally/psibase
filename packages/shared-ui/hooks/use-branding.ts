import type { QueryOptions } from "./types";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@shared/lib/query-keys";
import { supervisor } from "@shared/lib/supervisor";

export const queryBranding = queryOptions({
    queryKey: QueryKey.branding(),
    queryFn: async () => {
        try {
            const res = await supervisor.functionCall({
                service: "branding",
                intf: "queries",
                method: "getNetworkName",
                params: [],
            });
            return z.string().parse(res);
        } catch (error) {
            console.error("Error getting network branding", error);
            throw error;
        }
    },
});

export const useBranding = (
    options?: QueryOptions<
        string,
        Error,
        string,
        ReturnType<typeof QueryKey.branding>
    >,
) => {
    const queryOptions = options ?? {};
    return useQuery({ ...queryBranding, ...queryOptions });
};
