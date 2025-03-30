import { Account } from "@/lib/zod/Account";
import { queryClient } from "@/main";
import { getSupervisor } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export type GetCurrentUserRes = string | null;

export const queryFn = async () => {
    const res = await getSupervisor().functionCall({
        method: "getCurrentUser",
        params: [],
        service: "accounts",
        intf: "api",
    });
    return res ? Account.parse(res) : null;
};

export const useCurrentUser = () =>
    useQuery({
        queryKey: ['currentUser'],
        queryFn,
        staleTime: 60000,
    });

export const setCurrentUser = (accountName: z.infer<typeof Account> | null) => {
    queryClient.setQueryData(['currentUser'], () =>
        accountName === null ? null : Account.parse(accountName),
    );
};
