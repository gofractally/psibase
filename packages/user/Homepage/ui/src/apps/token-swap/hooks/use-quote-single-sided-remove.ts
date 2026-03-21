import { tokenSwap, usePluginFunctionQuery } from "@shared/lib/plugins";
import { Pool, TokenAmount } from "@shared/lib/plugins/token-swap";

export const useQuoteSingleSidedRemove = (
    enabled: boolean,
    pool?: Pool,
    tokenBalance?: string,
    desiredAmount?: TokenAmount,
) =>
    usePluginFunctionQuery(
        tokenSwap.liquidity.quoteSingleSidedRemove,
        [pool!, tokenBalance, desiredAmount!],
        { enabled },
    );

    