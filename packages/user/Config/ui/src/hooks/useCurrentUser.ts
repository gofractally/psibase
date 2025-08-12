import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";

export type GetCurrentUserRes = string | null;

export const queryFn = async () => {
    const res = await supervisor.functionCall({
        method: "getCurrentUser",
        params: [],
        service: "accounts",
        intf: "api",
    });
    return res ? z.string().parse(res) : null;
};

export const useCurrentUser = (refetchInterval?: number) =>
    useQuery({
        queryKey: QueryKey.currentUser(),
        queryFn,
        refetchInterval,
        staleTime: 60000,
    });

export const getCurrentUser = (): string | null => {
    const res = queryClient.getQueryData(QueryKey.currentUser());
    return res ? z.string().parse(res) : null;
};
