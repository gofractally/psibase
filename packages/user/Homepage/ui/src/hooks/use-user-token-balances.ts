import { type UseQueryResult, useQuery } from "@tanstack/react-query";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import {
    type UserTokenBalance,
    toUserTokenBalances,
} from "@shared/hooks/use-user-token-balances";
import { callPluginFunction, homepage } from "@shared/lib/plugins";
import QueryKey from "@shared/lib/query-keys";
import { type Account, zAccount } from "@shared/lib/schemas/account";

export {
    getSystemTokenBalance,
    type UserTokenBalance,
} from "@shared/hooks/use-user-token-balances";

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
                homepage.tokens.getUserBalances,
                [zAccount.parse(username)],
            );
            return toUserTokenBalances(nodes);
        },
        enabled: !!username && (options?.enabled ?? true),
    });
};
