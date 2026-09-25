import { type UseQueryResult, useQuery } from "@tanstack/react-query";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { hostingAppCall } from "@shared/lib/plugins/host-app";
import { callPluginFunction } from "@shared/lib/plugins/lib/call-plugin-function";
import { type UserBalance } from "@shared/lib/plugins/tokens";
import { Quantity } from "@shared/lib/quantity";
import QueryKey from "@shared/lib/query-keys";
import { type Account, zAccount } from "@shared/lib/schemas/account";

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

export function toUserTokenBalances(nodes: UserBalance[]): UserTokenBalance[] {
    return nodes.map((node) => ({
        id: node.tokenId,
        symbol: node.symbol ?? null,
        precision: node.precision,
        balance: new Quantity(
            node.balance,
            node.precision,
            node.tokenId,
            node.symbol,
        ),
    }));
}

export const useUserTokenBalances = (
    optionalUsername?: Account | undefined | null,
    options?: { enabled?: boolean },
): UseQueryResult<UserTokenBalance[], Error> => {
    const { data: currentUser } = useCurrentUser();
    const username = optionalUsername ?? currentUser;

    return useQuery({
        queryKey: QueryKey.userTokenBalances(username),
        queryFn: async (): Promise<UserTokenBalance[]> => {
            const nodes = await callPluginFunction(
                hostingAppCall<[user: string], UserBalance[]>(
                    "tokens",
                    "getUserBalances",
                ),
                [zAccount.parse(username)],
            );
            return toUserTokenBalances(nodes);
        },
        enabled: !!username && (options?.enabled ?? true),
    });
};
