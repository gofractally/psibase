import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { getSupervisor } from "@psibase/common-lib";

const supervisor = getSupervisor();

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
