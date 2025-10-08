import { queryClient } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { z } from "zod";

import { fetchUserTokenBalances } from "@/apps/tokens/lib/graphql/ui";
import { Quantity } from "@/apps/tokens/lib/quantity";

import QueryKey from "@/lib/queryKeys";
import { updateArray } from "@/lib/updateArray";
import { Account } from "@/lib/zod/Account";

import { toast } from "@shared/shadcn/ui/sonner";

export interface Token {
    id: number;
    balance?: Quantity;
    owner: string;
    isAdmin: boolean;
    symbol: string;
    label: string;
    precision: number;
}

export const useUserTokenBalances = (
    username: z.infer<typeof Account> | undefined | null,
) => {
    const toasted = useRef(false);
    return useQuery<Token[]>({
        queryKey: QueryKey.userTokenBalances(username),
        enabled: !!username,
        queryFn: async () => {
            if (!toasted.current) toast("Fetching token balances...");
            const res = await fetchUserTokenBalances(Account.parse(username));

            const userTokenBalances: Token[] = res.map((balance): Token => {
                const quan = new Quantity(
                    balance.balance,
                    balance.precision,
                    balance.tokenId,
                    balance.symbol,
                );

                return {
                    id: balance.tokenId,
                    owner: "", // unused
                    isAdmin: false, // unused
                    symbol: balance.symbol,
                    precision: quan.precision,
                    label: quan.getDisplayLabel(),
                    balance: quan,
                };
            });

            const tokenBalances = userTokenBalances.filter(
                (token, index, arr) =>
                    arr.findIndex((t) => t.id == token.id) == index,
            );

            if (!toasted.current) {
                toasted.current = true;
                toast.success("Fetched token balances");
            }

            return tokenBalances;
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
