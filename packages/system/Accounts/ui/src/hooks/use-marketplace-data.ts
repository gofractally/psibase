import { type UseQueryResult, useQuery } from "@tanstack/react-query";

import { useCanBuyAccount as useCanBuyAccountShared } from "@shared/hooks/use-can-buy-account";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import {
    type SystemTokenInfo,
    toSystemTokenInfo,
} from "@shared/hooks/use-system-token";
import {
    type UserTokenBalance,
    toUserTokenBalances,
} from "@shared/hooks/use-user-token-balances";
import { accounts, callPluginFunction } from "@shared/lib/plugins";
import QueryKey from "@shared/lib/query-keys";
import { type Account, zAccount } from "@shared/lib/schemas/account";
import {
    type AccountMarketOverviewRow,
    buildAccountMarketOverviewRows,
} from "@shared/lib/schemas/account-markets";
import {
    ACCOUNT_MARKETS_REFETCH_INTERVAL_MS,
    type UseAccountMarketsOptions,
} from "@shared/hooks/use-account-markets";

export {
    getSystemTokenBalance,
    type UserTokenBalance,
} from "@shared/hooks/use-user-token-balances";
export { ACCOUNT_MARKETS_REFETCH_INTERVAL_MS };

export const useSystemToken = () =>
    useQuery<SystemTokenInfo | null>({
        queryKey: QueryKey.systemToken(),
        queryFn: async () =>
            toSystemTokenInfo(
                await callPluginFunction(accounts.tokens.getSystemToken, []),
            ),
    });

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
                accounts.tokens.getUserBalances,
                [zAccount.parse(username)],
            );
            return toUserTokenBalances(nodes);
        },
        enabled: !!username && (options?.enabled ?? true),
    });
};

export const useAccountMarkets = (options?: UseAccountMarketsOptions) =>
    useQuery({
        queryKey: QueryKey.nameMarketsOverview(),
        queryFn: async (): Promise<AccountMarketOverviewRow[]> => {
            const overview = await callPluginFunction(
                accounts.nameMarket.getMarketsOverview,
                [],
            );
            return buildAccountMarketOverviewRows(
                overview.marketParams,
                overview.currentPrices,
            );
        },
        refetchInterval: options?.refetchInterval ?? false,
        enabled: options?.enabled ?? true,
    });

export const useCanBuyAccount = (options?: { enabled?: boolean }) =>
    useCanBuyAccountShared(accounts.nameMarket.canCreateAccount, options);
