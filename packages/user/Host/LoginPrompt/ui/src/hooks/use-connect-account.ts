import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { callLoginPrompt } from "../lib/login-prompt";

export const useConnectAccount = (
    options: UseMutationOptions<void, Error, string> = {},
) => {
    return useMutation({
        mutationFn: (accountName: string) =>
            callLoginPrompt<void>("api", "connectAccount", [accountName]),
        ...options,
    });
};
