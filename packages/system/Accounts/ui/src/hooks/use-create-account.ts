import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { supervisor } from "@shared/lib/supervisor";

export const useCreateAccount = (
    options: UseMutationOptions<string, Error, string> = {},
) => {
    return useMutation({
        mutationFn: async (accountName: string) => {
            return await supervisor.functionCall({
                service: "accounts",
                plugin: "plugin",
                intf: "prompt",
                method: "createAccount",
                params: [accountName],
            });
        },
        ...options,
    });
};
