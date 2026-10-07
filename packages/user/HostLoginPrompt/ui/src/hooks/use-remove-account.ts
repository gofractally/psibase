import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { callLoginPrompt } from "../lib/login-prompt";

export const useRemoveAccount = (
    options: UseMutationOptions<void, Error, string> = {},
) => {
    return useMutation({
        mutationFn: (accountName: string) =>
            callLoginPrompt<void>("admin", "removeAccount", [accountName]),
        onSuccess: (_data, _variables, _onMutateResult, context) => {
            context.client.invalidateQueries({
                queryKey: QueryKey.getAllAccounts(),
            });
        },
        ...options,
    });
};
