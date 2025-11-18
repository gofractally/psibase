import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { getSupervisor } from "@psibase/common-lib";

const supervisor = getSupervisor();

export const useImportExisting = (
    options: UseMutationOptions<void, Error, string> = {},
) => {
    return useMutation({
        mutationFn: async (accountName: string) => {
            await supervisor.functionCall({
                service: "accounts",
                plugin: "plugin",
                intf: "prompt",
                method: "importExisting",
                params: [accountName],
            });
        },
        ...options,
    });
};

