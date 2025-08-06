import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { Account, zAccount } from "@/lib/zod/Account";

export type GetCurrentUserRes = string | null;

export const queryFn = async () => {
    try {
        const res = await supervisor.functionCall({
            method: "getCurrentUser",
            params: [],
            service: "accounts",
            intf: "api",
        });
        return res ? z.string().parse(res) : null;
    } catch (error) {
        const message = "Error getting current user";
        console.error(message, error);
        throw new Error(message);
    }
};

export const useCurrentUser = (refetchInterval?: number) =>
    useQuery({
        queryKey: QueryKey.currentUser(),
        queryFn,
        refetchInterval,
        staleTime: 60000,
    });

export const assertUser = (): Account =>
    zAccount.parse(queryClient.getQueryData(QueryKey.currentUser()));
