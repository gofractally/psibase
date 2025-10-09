import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";
import { TokenId } from "@/lib/zod/TokenId";

import { updateUserTokenBalancesCache } from "./useUserTokenBalances";

const Args = z.object({
    tokenId: TokenId,
    debitor: Account,
    amount: z.string(),
    memo: z.string().default(""),
});

export const useUncredit = (user: string | null) =>
    useMutation<void, Error, z.infer<typeof Args>>({
        mutationKey: ["uncredit"],
        mutationFn: (vars) => {
            console.log("uncredit", vars);
            const { amount, memo, tokenId, debitor } = Args.parse(vars);

            // Optimistically update the balance
            updateUserTokenBalancesCache(
                Account.parse(user),
                tokenId,
                amount,
                "Add",
            );

            return supervisor.functionCall({
                service: "tokens",
                method: "uncredit",
                params: [tokenId, debitor, amount, memo],
                intf: "transfer",
            });
        },
        onSuccess: (_data, vars, _result, context) => {
            const parsedUser = Account.parse(user);

            // Invalidate queries to update the token balance
            context.client.invalidateQueries({
                queryKey: QueryKey.userTokenBalances(parsedUser),
            });

            // Invalidate queries to update the recent transactions table
            context.client.invalidateQueries({
                queryKey: QueryKey.userTokenBalanceChanges(
                    parsedUser,
                    Number(vars.tokenId),
                ),
            });

            // Invalidate queries to update the pending transactions table
            context.client.invalidateQueries({
                queryKey: QueryKey.userLinesOfCredit(parsedUser),
            });
        },
        onError: (_error, vars) => {
            // Rollback optimistic update on error
            updateUserTokenBalancesCache(
                Account.parse(user),
                vars.tokenId,
                vars.amount,
                "Subtract",
            );
        },
    });
