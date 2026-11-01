import { useUserTokenBalances } from "@/apps/tokens/hooks/tokens-plugin/use-user-token-balances";

import { useSystemToken } from "@shared/hooks/use-system-token";

export const useSystemTokenBalance = () => {
    const { data: systemToken, isLoading: isLoadingToken } = useSystemToken();
    const balances = useUserTokenBalances();

    const hasBalance =
        balances.data?.some(
            (token) =>
                systemToken != null &&
                String(token.id) === systemToken.id &&
                (token.balance?.amount ?? 0) > 0,
        ) ?? false;

    return {
        hasBalance,
        isLoading: isLoadingToken || balances.isLoading,
    };
};
