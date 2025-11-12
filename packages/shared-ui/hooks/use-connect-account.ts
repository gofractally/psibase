import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { supervisor } from "@shared/lib/supervisor";

export const useConnectAccount = (
    options: UseMutationOptions<void, Error> = {},
) => {
    return useMutation({
        mutationFn: async () => {
            await supervisor.functionCall({
                service: "accounts",
                intf: "activeApp",
                method: "connectAccount",
                params: [],
            });
        },
        ...options,
    });
};
