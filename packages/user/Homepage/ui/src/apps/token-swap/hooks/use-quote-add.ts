import { tokenSwap, usePluginFunctionQuery } from "@shared/lib/plugins";
import { Pool } from "@shared/lib/plugins/token-swap";

export const useQuoteAdd = (
    enabled: boolean,
    pool?: Pool,
    tokenId?: number,
    amount?: string,
) =>
    usePluginFunctionQuery(
        tokenSwap.liquidity.quoteAddLiquidity,
        [pool!, { amount: amount!, tokenId: tokenId!}],
        { enabled },
    );
