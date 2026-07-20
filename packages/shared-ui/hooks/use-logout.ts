import { useMutation, UseMutationOptions } from "@tanstack/react-query";

import { supervisor } from "@shared/lib/supervisor";
import QueryKey from "@shared/lib/query-keys";

export const useLogout = (
    options: UseMutationOptions<void, Error> = {},
) => {
    return useMutation({
        mutationFn: async () =>
            supervisor.functionCall({
                service: "accounts",
                intf: "activeApp",
                method: "logout",
                params: [],
            }),
        ...options,
        onSuccess: (data, variables, onMutateResult, context) => {
            context.client.setQueryData(QueryKey.currentUser(), null);
            options.onSuccess?.(data, variables, onMutateResult, context);
        },
    });
}
