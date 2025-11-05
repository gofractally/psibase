import type { Token } from "./use-user-token-balances";

import { fetchUserTokenBalanceChanges } from "@/apps/tokens/lib/graphql/ui";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { Quantity } from "@shared/lib/quantity";

export const zActionType = z.enum([
    "credited",
    "debited",
    "uncredited",
    "rejected",
]);
export const zDirection = z.enum(["outgoing", "incoming"]);

export type ActionType = z.infer<typeof zActionType>;

export interface Transaction {
    counterParty: string;
    action: ActionType;
    direction: z.infer<typeof zDirection>;
    amount: Quantity;
    memo: string;
}

export const useUserTokenBalanceChanges = (
    username: z.infer<typeof zAccount> | undefined | null,
    token: Token,
) => {
    return useQuery<Transaction[]>({
        queryKey: QueryKey.userTokenBalanceChanges(username, token.id),
        enabled: !!username,
        refetchInterval: 10000,
        queryFn: async () => {
            const res = await fetchUserTokenBalanceChanges(
                zAccount.parse(username),
                token.id,
            );

            const userTokenBalances: Transaction[] = res.map(
                (balance): Transaction => {
                    if (token.id !== balance.tokenId) {
                        throw new Error("Token ID mismatch");
                    }

                    const quantity = new Quantity(
                        balance.amount,
                        token.precision,
                        balance.tokenId,
                        token.symbol,
                    );

                    const direction =
                        balance.action === "credited" ? "outgoing" : "incoming";

                    return {
                        counterParty: balance.counterParty,
                        action: balance.action,
                        direction,
                        amount: quantity,
                        memo: balance.memo,
                    };
                },
            );

            return userTokenBalances.reverse();
        },
    });
};
