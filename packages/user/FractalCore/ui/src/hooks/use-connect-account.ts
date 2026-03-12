import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { supervisor } from "@shared/lib/supervisor";
import { AutoRedirectConfig } from "@psibase/common-lib";

export const useConnectAccount = (
    options: UseMutationOptions<void, Error, AutoRedirectConfig | undefined> = {},
) => useMutation({
    mutationFn: async (autoRedirectConfig?) => {
        await supervisor.functionCall({
            service: "accounts",
            intf: "activeApp",
            method: "connectAccount",
            params: [],
        }, autoRedirectConfig);
    },
    ...options,
})