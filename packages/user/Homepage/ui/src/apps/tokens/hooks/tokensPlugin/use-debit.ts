import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";
import { TokenId } from "@/lib/zod/TokenId";

import { updateUserTokenBalancesCache } from "./use-user-token-balances";

const Args = z.object({
    tokenId: TokenId,
    sender: zAccount,
    amount: z.string(),
    memo: z.string().default(""),
});

export const useDebit = (user: string | null, counterParty: string) =>
    useMutation<void, Error, z.infer<typeof Args>>({
        mutationKey: ["debit", counterParty],
        mutationFn: (vars) => {
            const { sender, amount, memo, tokenId } = Args.parse(vars);

            // Optimistically update the balance
            updateUserTokenBalancesCache(
                zAccount.parse(user),
                tokenId,
                amount,
                "Add",
            );

            return supervisor.functionCall({
                service: "tokens",
                plugin: "plugin",
                intf: "user",
                method: "debit",
                params: [tokenId, sender, amount, memo],
            });
        },
        onSuccess: (_data, vars, _result, context) => {
            const parsedUser = zAccount.parse(user);

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
                zAccount.parse(user),
                vars.tokenId,
                vars.amount,
                "Subtract",
            );
        },
    });
