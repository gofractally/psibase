import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { callLoginPrompt } from "../lib/login-prompt";

export const usePurchaseAccount = (
    options: UseMutationOptions<string, Error, [string, string]> = {},
) => {
    return useMutation({
        mutationFn: ([accountName, maxCost]: [string, string]) =>
            callLoginPrompt<string>("api", "createPremium", [
                accountName,
                maxCost,
            ]),
        ...options,
    });
};
