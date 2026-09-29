import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { supervisor } from "@shared/lib/supervisor";

export const useLogin = (
    options: UseMutationOptions<void, Error, string> = {},
) => {
    return useMutation({
        mutationFn: async (accountName: string) => {
            await supervisor.functionCall({
                service: "accounts",
                plugin: "prompt",
                intf: "prompt",
                method: "login",
                params: [accountName],
            });
        },
        ...options,
    });
};
