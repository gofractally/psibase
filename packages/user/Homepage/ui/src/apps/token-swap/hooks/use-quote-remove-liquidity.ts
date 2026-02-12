import { tokenSwap, usePluginFunctionQuery } from "@shared/lib/plugins";
import { Pool } from "@shared/lib/plugins/token-swap";

export const useQuoteRemoveLiquidity = (
    enabled: boolean,
    pool?: Pool,
    amount?: string,
) =>
    usePluginFunctionQuery(
        tokenSwap.liquidity.quoteRemoveLiquidity,
        [pool!, amount!],
        {
            enabled,
        },
    );


    