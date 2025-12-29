import { queryClient } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@shared/lib/supervisor";

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
        queryKey: ["currentUser"],
        queryFn,
        refetchInterval,
        staleTime: 60000,
    });

export const assertUser = (): string =>
    z.string().parse(queryClient.getQueryData(["currentUser"]));

export const getCurrentUser = (): string | null => {
    const res = queryClient.getQueryData(["currentUser"]);
    return res ? z.string().parse(res) : null;
};
