import type { Token } from "./useUserTokenBalances";

import { queryClient } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { z } from "zod";

import { fetchUserTokenBalanceChanges } from "@/apps/tokens/lib/graphql/ui";
import { Quantity } from "@/apps/tokens/lib/quantity";

import QueryKey from "@/lib/queryKeys";
import { updateArray } from "@/lib/updateArray";
import { Account } from "@/lib/zod/Account";

import { toast } from "@shared/shadcn/ui/sonner";

export interface Transaction {
    counterParty: string;
    action: "credited" | "debited" | "uncredited" | "rejected";
    amount: Quantity;
    memo: string;
}

export const useUserTokenTransactions = (
    username: z.infer<typeof Account> | undefined | null,
    token: Token,
) => {
    const toasted = useRef(false);
    return useQuery<Transaction[]>({
        queryKey: QueryKey.userTokenBalances(username),
        enabled: !!username,
        refetchInterval: 10000,
        queryFn: async () => {
            if (!toasted.current) toast("Fetching token balances...");
            const res = await fetchUserTokenBalanceChanges(
                Account.parse(username),
                token.id,
            );

            const userTokenBalances: Transaction[] = res.map(
                (balance): Transaction => {
                    if (token.id !== balance.tokenId) {
                        throw new Error("Token ID mismatch");
                    }

                    const quan = new Quantity(
                        balance.amount,
                        token.precision,
                        balance.tokenId,
                        token.symbol,
                    );

                    // let action: "added" | "subtracted" = "added";
                    // let status: "pending" | "posted" = "pending"; // TODO: how do we detect a transaction awaiting action by party or counterparty?
                    // switch (balance.action) {
                    //     case "credited":
                    //         action = "subtracted";
                    //         status = "posted";
                    //         break;
                    //     case "debited":
                    //         action = "added";
                    //         status = "posted";
                    //         break;
                    //     case "uncredited":
                    //         action = "added";
                    //         status = "posted";
                    //         break;
                    //     case "rejected":
                    //         action = "added";
                    //         status = "posted";
                    //         break;
                    // }

                    return {
                        counterParty: balance.counterParty,
                        action: balance.action,
                        amount: quan,
                        memo: balance.memo,
                    };
                },
            );

            return userTokenBalances;

            // const tokenBalances = userTokenBalances.filter(
            //     (token, index, arr) =>
            //         arr.findIndex((t) => t.id == token.id) == index,
            // );

            // if (!toasted.current) {
            //     toasted.current = true;
            //     toast.success("Fetched token balances");
            // }

            // return tokenBalances;
        },
    });
};

const Operation = z.enum(["Add", "Subtract"]);

export const updateUserTokenBalancesCache = (
    username: string,
    tokenId: string,
    amount: string,
    operation: z.infer<typeof Operation>,
) => {
    queryClient.setQueryData(
        QueryKey.userTokenBalances(username),
        (balances: Token[] | undefined) => {
            if (
                operation !== Operation.Enum.Add &&
                operation !== Operation.Enum.Subtract
            ) {
                throw new Error(`Unsupported operation`);
            }
            if (balances) {
                return updateArray(
                    balances,
                    (token) =>
                        token.id.toString() === tokenId && !!token.balance,
                    (token) => ({
                        ...token,
                        balance:
                            operation == "Add"
                                ? token.balance!.add(amount)
                                : token.balance!.subtract(amount),
                    }),
                );
            }
        },
    );
};
