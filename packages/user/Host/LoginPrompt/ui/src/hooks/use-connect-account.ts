import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { callLoginPrompt } from "../lib/login-prompt";

type ConnectAccount = {
    account: string;
    login: boolean;
};

export const useConnectAccount = (
    options: UseMutationOptions<void, Error, ConnectAccount> = {},
) => {
    return useMutation({
        mutationFn: ({ account, login }: ConnectAccount) =>
            callLoginPrompt<void>("api", "connectAccount", [account, login]),
        ...options,
    });
};
