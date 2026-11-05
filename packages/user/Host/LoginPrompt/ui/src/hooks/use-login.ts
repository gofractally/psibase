import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { callLoginPrompt } from "../lib/login-prompt";

export const useLogin = (
    options: UseMutationOptions<void, Error, string> = {},
) => {
    return useMutation({
        mutationFn: (accountName: string) =>
            callLoginPrompt<void>("api", "login", [accountName]),
        ...options,
    });
};
