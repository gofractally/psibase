import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { AutoRedirectConfig } from "@psibase/common-lib";

import { supervisor } from "@shared/lib/supervisor";

export const useConnectAccount = (
    options: UseMutationOptions<void, Error, AutoRedirectConfig | void> = {},
) =>
    useMutation({
        mutationFn: async (autoRedirectConfig?) => {
            await supervisor.functionCall(
                {
                    service: "accounts",
                    intf: "activeApp",
                    method: "connectAccount",
                    params: [],
                },
                autoRedirectConfig ?? undefined,
            );
        },
        ...options,
    });
