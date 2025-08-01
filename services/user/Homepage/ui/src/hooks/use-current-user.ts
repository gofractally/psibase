import { queryClient } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

export type GetCurrentUserRes = string | null;

export const queryFn = async () => {
    const res = await supervisor.functionCall({
        method: "getCurrentUser",
        params: [],
        service: "accounts",
        intf: "api",
    });
    return res ? Account.parse(res) : null;
};

export const useCurrentUser = () =>
    useQuery({
        queryKey: QueryKey.currentUser(),
        queryFn,
        staleTime: 60000,
    });

export const setCurrentUser = (accountName: z.infer<typeof Account> | null) => {
    queryClient.setQueryData(QueryKey.currentUser(), () =>
        accountName === null ? null : Account.parse(accountName),
    );
};
