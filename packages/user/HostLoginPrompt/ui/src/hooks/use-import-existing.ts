import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { callLoginPrompt } from "../lib/login-prompt";

type Credential = {
    account: string;
    key: string;
};

export const useImportExisting = (
    options: UseMutationOptions<void, Error, Credential> = {},
) => {
    return useMutation({
        mutationFn: (credential: Credential) =>
            callLoginPrompt<void>("api", "importExisting", [[credential]]),
        ...options,
    });
};
