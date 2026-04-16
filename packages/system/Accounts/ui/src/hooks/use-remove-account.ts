import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { supervisor } from "@shared/lib/supervisor";

export const useRemoveAccount = (
    options: UseMutationOptions<void, Error, string> = {},
) => {
    return useMutation({
        mutationFn: async (accountName: string) => {
            await supervisor.functionCall({
                service: "accounts",
                plugin: "plugin",
                intf: "admin",
                method: "removeAccount",
                params: [accountName],
            });
        },
        onSuccess: (_data, _variables, _onMutateResult, context) => {
            context.client.invalidateQueries({
                queryKey: QueryKey.getAllAccounts(),
            });
        },
        ...options,
    });
};
