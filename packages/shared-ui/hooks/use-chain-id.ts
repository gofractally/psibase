import type { QueryOptions } from "./types";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@shared/lib/query-keys";

export const queryChainId = queryOptions({
    queryKey: QueryKey.chainId(),
    initialData: "",
    queryFn: async () => {
        const res = await fetch("/common/chainid");
        const json = await res.json();
        return z.string().parse(json);
    },
});

export const useChainId = (
    options?: QueryOptions<
        string,
        Error,
        string,
        ReturnType<typeof QueryKey.chainId>
    >,
) => {
    const queryOptions = options ?? {};
    return useQuery({ ...queryChainId, ...queryOptions });
};
