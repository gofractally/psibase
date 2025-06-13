import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";
import { getSupervisor } from "@psibase/common-lib";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

export type GetCurrentUserRes = string | null;

const supervisor = getSupervisor();

export const queryFn = async () => {
    const res = await supervisor.functionCall({
        method: "getCurrentUser",
        params: [],
        service: "accounts",
        intf: "api",
    });
    return res ? Account.parse(res) : null;
};

export const useCurrentUser = () => {
    const queryClient = useQueryClient();
    const { data, ...queryRest } = useQuery({
        queryKey: QueryKey.currentUser(),
        queryFn,
        staleTime: 60000,
    });
    const setCurrentUser = (accountName: z.infer<typeof Account> | null) => {
        queryClient.setQueryData(QueryKey.currentUser(), () =>
            accountName === null ? null : Account.parse(accountName),
        );
    };
    return [data, setCurrentUser, queryRest] as const;
};
