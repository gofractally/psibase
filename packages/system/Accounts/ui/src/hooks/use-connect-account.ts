import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { supervisor } from "@shared/lib/supervisor";

interface Account {
    accountNum: string;
    authService: string;
}

export const useLogin = (
    options: UseMutationOptions<void, Error, string> = {},
) => {
    return useMutation({
        mutationFn: async (accountName: string) => {
            const account = (await supervisor.functionCall({
                service: "accounts",
                plugin: "plugin",
                intf: "api",
                method: "getAccount",
                params: [accountName],
            })) as Account | undefined;

            if (!account) {
                throw new Error(`Account not found: ${accountName}`);
            }

            await supervisor.functionCall({
                service: account.authService,
                plugin: "plugin",
                intf: "session",
                method: "login",
                params: [accountName],
            });
        },
        ...options,
    });
};
