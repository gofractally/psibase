import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { callLoginPrompt } from "../lib/login-prompt";

export const useCreateAccount = (
    options: UseMutationOptions<string, Error, string> = {},
) => {
    return useMutation({
        mutationFn: (accountName: string) =>
            callLoginPrompt<string>("api", "createAccount", [accountName]),
        ...options,
    });
};
