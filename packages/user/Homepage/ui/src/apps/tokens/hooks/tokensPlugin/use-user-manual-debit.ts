import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

import { fetchUserSettings } from "../../lib/graphql/ui";

export const useUserManualDebit = (user: string | null) => {
    return useQuery<boolean>({
        queryKey: QueryKey.userSettings(user),
        enabled: !!user,
        queryFn: async () => {
            const res = await fetchUserSettings(Account.parse(user));
            return res.manualDebit;
        },
    });
};

const Args = z.object({
    enable: z.boolean(),
});

export const useToggleUserManualDebit = (user: string | null) => {
    return useMutation<void, Error, z.infer<typeof Args>>({
        mutationKey: ["user-manual-debit"],
        mutationFn: (vars) => {
            const { enable } = Args.parse(vars);

            return supervisor.functionCall({
                service: "tokens",
                plugin: "plugin",
                intf: "userConfig",
                method: "enableUserManualDebit",
                params: [enable],
            });
        },
        onSuccess: (_data, vars, _result, context) => {
            const parsedUser = Account.parse(user);
            // Invalidate queries to update the token balance
            context.client.invalidateQueries({
                queryKey: QueryKey.userSettings(parsedUser),
            });
        },
        // onError: (_error, vars) => {
        //     // Rollback optimistic update on error
        //     updateUserTokenBalancesCache(
        //         Account.parse(user),
        //         vars.tokenId,
        //         vars.amount,
        //         "Add",
        //     );
        // },
    });
};
