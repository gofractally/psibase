import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import {
    type TokenSummary,
    fetchTokenMeta,
    fetchUserTokensWithActivity,
} from "@/apps/tokens/lib/graphql/ui";

import QueryKey from "@/lib/query-keys";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { callPluginFunction, homepage } from "@shared/lib/plugins";
import { Quantity } from "@shared/lib/quantity";
import { queryClient } from "@shared/lib/query-client";
import { type Account, zAccount } from "@shared/lib/schemas/account";
import { updateArray } from "@shared/lib/update-array";

export interface Token {
    id: number;
    balance?: Quantity;
    symbol: string | null;
    label: string;
    precision: number;
    isTransferable: boolean;
    icon: string | null;
    owner: string | null;
}

/** A token the user has no balance in, e.g. one with only past or pending activity */
export const zeroBalanceToken = (token: TokenSummary): Token => {
    const balance = new Quantity("0", token.precision, token.id, token.symbol);
    return {
        id: token.id,
        balance,
        symbol: token.symbol,
        label: balance.getDisplayLabel(),
        precision: token.precision,
        isTransferable: !token.settings.untransferable,
        icon: token.icon,
        owner: token.owner,
    };
};

/** Tokens with balance history for the user, including those now at zero */
export const useUserTokensWithActivity = (username?: Account | null) =>
    useQuery<TokenSummary[]>({
        queryKey: QueryKey.userTokensWithActivity(username),
        enabled: !!username,
        queryFn: () => fetchUserTokensWithActivity(zAccount.parse(username)),
    });

export const useUserTokenBalances = (
    optionalUsername?: Account | undefined | null,
) => {
    const { data: currentUser } = useCurrentUser();
    const username = optionalUsername || currentUser;
    return useQuery<Token[]>({
        queryKey: QueryKey.userTokenBalances(username),
        enabled: !!username,
        queryFn: async () => {
            const res = await callPluginFunction(
                homepage.tokens.getUserBalances,
                [zAccount.parse(username)],
            );

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

                const meta = tokensMeta.find(
                    (meta) => meta.id === balance.tokenId,
                );

                return {
                    id: balance.tokenId,
                    symbol: balance.symbol ?? null,
                    precision: quan.precision,
                    label: quan.getDisplayLabel(),
                    balance: quan,
                    isTransferable: meta?.settings.untransferable === false,
                    icon: balance.icon ?? null,
                    owner: meta?.owner ?? null,
                };
            });

            const tokenBalances = userTokenBalances.filter(
                (token, index, arr) =>
                    arr.findIndex((t) => t.id == token.id) == index,
            );

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
