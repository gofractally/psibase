import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { callLoginPrompt } from "../lib/login-prompt";

type FinishImport = {
    account: string;
    login: boolean;
};

export const useFinishImport = (
    options: UseMutationOptions<void, Error, FinishImport> = {},
) => {
    return useMutation({
        mutationFn: ({ account, login }: FinishImport) =>
            callLoginPrompt<void>("api", "finishImport", [account, login]),
        ...options,
    });
};
