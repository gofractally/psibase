import {
    fetchTokenMeta,
    fetchUserTokenBalances,
} from "@/apps/tokens/lib/graphql/ui";
import { queryClient } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { z } from "zod";

import QueryKey from "@/lib/queryKeys";
import { updateArray } from "@/lib/updateArray";
import { Account } from "@/lib/zod/Account";

import { Quantity } from "@shared/lib/quantity";
import { toast } from "@shared/shadcn/ui/sonner";

export interface Token {
    id: number;
    balance?: Quantity;
    symbol: string | null;
    label: string;
    precision: number;
    isTransferable: boolean;
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

            // TODO: Remove this once token settings comes back from `fetchUserTokenBalances`
            const tokenMetaPromises = res.map(async (balance) => {
                return await fetchTokenMeta(balance.tokenId.toString());
            });
            const tokensMeta = await Promise.all(tokenMetaPromises);
            // END TODO

            const userTokenBalances: Token[] = res.map((balance): Token => {
                const quan = new Quantity(
                    balance.balance,
                    balance.precision,
                    balance.tokenId,
                    balance.symbol,
                );

                return {
                    id: balance.tokenId,
                    symbol: balance.symbol,
                    precision: quan.precision,
                    label: quan.getDisplayLabel(),
                    balance: quan,
                    isTransferable:
                        tokensMeta.find((meta) => meta.id === balance.tokenId)
                            ?.settings.untransferable === false,
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
            Operation.parse(operation);
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
