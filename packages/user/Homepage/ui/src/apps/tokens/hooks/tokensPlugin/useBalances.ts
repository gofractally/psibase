import { fetchUi } from "@/apps/tokens/lib/graphql/ui";
import { Quantity } from "@/apps/tokens/lib/quantity";
import { queryClient } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

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

export interface SharedBalance {
    id: string;
    tokenId: number;
    creditor: string;
    debitor: string;
    label: string;
    amount: Quantity;
}

export interface BalanceRes {
    tokens: Token[];
    sharedBalances: SharedBalance[];
}

let toasted = false;

export const useBalances = (
    username: z.infer<typeof Account> | undefined | null,
) =>
    useQuery<BalanceRes>({
        queryKey: QueryKey.ui(username || "undefined"),
        enabled: !!username,
        refetchInterval: 10000,
        queryFn: async () => {
            if (!toasted) {
                toast("Fetching token balances...");
            }
            const res = await fetchUi(Account.parse(username));

            const creditBalances = res.userCredits.map(
                (credit): SharedBalance => {
                    const amount = new Quantity(
                        credit.balance,
                        credit.precision.value,
                        credit.tokenId,
                        credit.symbolId,
                    );
                    return {
                        amount,
                        creditor: username || "",
                        debitor: credit.creditedTo!,
                        id:
                            credit.tokenId.toString() +
                                credit.creditedTo! +
                                username || "",
                        label: amount.getDisplayLabel(),
                        tokenId: credit.tokenId,
                    };
                },
            );

            const debitBalances = res.userDebits.map((debit): SharedBalance => {
                const amount = new Quantity(
                    debit.balance,
                    debit.precision.value,
                    debit.tokenId,
                    debit.symbolId,
                );
                return {
                    amount,
                    creditor: debit.debitableFrom!,
                    debitor: username || "",
                    id:
                        debit.tokenId.toString() +
                            debit.debitableFrom! +
                            username || "",
                    label: amount.getDisplayLabel(),
                    tokenId: debit.tokenId,
                };
            });

            const sharedBalances: SharedBalance[] = [
                ...creditBalances,
                ...debitBalances,
            ];

            const userBalanceTokens: Token[] = res.userBalances.map(
                (balance): Token => {
                    const quan = new Quantity(
                        balance.balance,
                        balance.precision.value,
                        balance.tokenId,
                        balance.symbolId,
                    );

                    return {
                        id: balance.tokenId,
                        owner: "",
                        isAdmin: res.userTokens.some(
                            (user) => user.id == balance.tokenId,
                        ),
                        symbol: balance.symbolId,
                        precision: quan.getPrecision(),
                        label: quan.getDisplayLabel(),
                        balance: quan,
                    };
                },
            );

            const userTokens = res.userTokens.map((userToken): Token => {
                const quan = new Quantity(
                    "1",
                    userToken.precision.value,
                    userToken.id,
                    userToken.symbolId,
                );
                return {
                    id: userToken.id,
                    isAdmin: true,
                    label: quan.getDisplayLabel(),
                    precision: userToken.precision.value,
                    owner: username || "",
                    symbol: userToken.symbolId,
                };
            });
            const tokens = [...userBalanceTokens, ...userTokens].filter(
                (token, index, arr) =>
                    arr.findIndex((t) => t.id == token.id) == index,
            );

            if (!toasted) {
                toasted = true;
                toast.success("Fetched token balances");
            }
            return { tokens, sharedBalances };
        },
    });

const Operation = z.enum(["Add", "Subtract"]);

export const updateBalanceCache = (
    username: string,
    tokenId: string,
    amount: string,
    operation: z.infer<typeof Operation>,
) => {
    queryClient.setQueryData(
        QueryKey.ui(username || "undefined"),
        (balances: BalanceRes | undefined) => {
            if (
                operation !== Operation.Enum.Add &&
                operation !== Operation.Enum.Subtract
            ) {
                throw new Error(`Unsupported operation`);
            }
            if (balances) {
                return {
                    ...balances,
                    tokens: updateArray(
                        balances.tokens,
                        (token) =>
                            token.id.toString() === tokenId && !!token.balance,
                        (token) => ({
                            ...token,
                            balance:
                                operation == "Add"
                                    ? token.balance!.add(amount)
                                    : token.balance!.subtract(amount),
                        }),
                    ),
                };
            }
        },
    );
};
