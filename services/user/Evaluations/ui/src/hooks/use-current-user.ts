import { queryClient } from "@/main";
import { useQuery } from "@tanstack/react-query";

import { getSupervisor } from "@psibase/common-lib";

import { Account, zAccount } from "@/lib/zod/Account";

export type GetCurrentUserRes = string | null;

export const queryFn = async () => {
    const res = await getSupervisor().functionCall({
        method: "getCurrentUser",
        params: [],
        service: "accounts",
        intf: "api",
    });
    return res ? zAccount.parse(res) : null;
};

export const useCurrentUser = () =>
    useQuery({
        queryKey: ["currentUser"],
        queryFn,
        staleTime: 60000,
    });

export const setCurrentUser = (accountName: Account | null) => {
    queryClient.setQueryData(["currentUser"], () =>
        accountName === null ? null : zAccount.parse(accountName),
    );
};
