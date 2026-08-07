import { type UseQueryResult, useQuery } from "@tanstack/react-query";

import { fetchUserTokenBalances } from "@shared/lib/graphql/tokens";
import { Quantity } from "@shared/lib/quantity";
import QueryKey from "@shared/lib/query-keys";
import { type Account, zAccount } from "@shared/lib/schemas/account";

import { useCurrentUser } from "./use-current-user";

export interface UserTokenBalance {
    id: number;
    balance: Quantity;
    symbol: string | null;
    precision: number;
}

export function getSystemTokenBalance(
    tokenBalances: UserTokenBalance[] | undefined,
    systemTokenId: string | number,
): Quantity | undefined {
    return tokenBalances?.find((token) => token.id === Number(systemTokenId))
        ?.balance;
}

type UserTokenBalancesQueryKey = ReturnType<typeof QueryKey.userTokenBalances>;

export const useUserTokenBalances = (
    optionalUsername?: Account | undefined | null,
    options?: { enabled?: boolean },
): UseQueryResult<UserTokenBalance[], Error> => {
    const { data: currentUser } = useCurrentUser();
    const username = optionalUsername ?? currentUser;

    return useQuery<
        UserTokenBalance[],
        Error,
        UserTokenBalance[],
        UserTokenBalancesQueryKey
    >({
        queryKey: QueryKey.userTokenBalances(username),
        queryFn: async (): Promise<UserTokenBalance[]> => {
            const nodes = await fetchUserTokenBalances(
                zAccount.parse(username),
            );

            return nodes.map(
                (node): UserTokenBalance => ({
                    id: node.tokenId,
                    symbol: node.symbol,
                    precision: node.precision,
                    balance: new Quantity(
                        node.balance,
                        node.precision,
                        node.tokenId,
                        node.symbol,
                    ),
                }),
            );
        },
        enabled: !!username && (options?.enabled ?? true),
    });
};
