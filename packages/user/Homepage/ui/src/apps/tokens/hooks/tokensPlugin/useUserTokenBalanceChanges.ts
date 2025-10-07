import type { Token } from "./useUserTokenBalances";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { fetchUserTokenBalanceChanges } from "@/apps/tokens/lib/graphql/ui";
import { Quantity } from "@/apps/tokens/lib/quantity";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

export const ActionType = z.enum([
    "credited",
    "debited",
    "uncredited",
    "rejected",
]);
export const zDirection = z.enum(["outgoing", "incoming"]);

export interface Transaction {
    counterParty: string;
    action: z.infer<typeof ActionType>;
    direction: z.infer<typeof zDirection>;
    amount: Quantity;
    memo: string;
}

export const useUserTokenBalanceChanges = (
    username: z.infer<typeof Account> | undefined | null,
    token: Token,
) => {
    return useQuery<Transaction[]>({
        queryKey: QueryKey.userTokenBalanceChanges(username, token.id),
        enabled: !!username,
        refetchInterval: 10000,
        queryFn: async () => {
            const res = await fetchUserTokenBalanceChanges(
                Account.parse(username),
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
