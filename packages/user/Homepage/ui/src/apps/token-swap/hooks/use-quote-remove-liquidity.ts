import { tokenSwap, usePluginFunctionQuery } from "@shared/lib/plugins";
import { Pool, TokenAmount } from "@shared/lib/plugins/token-swap";

export const useQuoteRemoveLiquidity = (
    enabled: boolean,
    pool?: Pool,
    tokenBalance?: string,
    desiredAmount?: TokenAmount,
) =>
    usePluginFunctionQuery(
        tokenSwap.liquidity.quoteRemoveLiquidity,
        [pool!, tokenBalance, desiredAmount!],
        { enabled },
    );
