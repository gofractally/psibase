import { homepage, usePluginFunctionQuery } from "@shared/lib/plugins";
import { Pool } from "@shared/lib/plugins/token-swap";

export const useQuoteRemoveLiquidity = (
    enabled: boolean,
    pool?: Pool,
    amount?: string,
) =>
    usePluginFunctionQuery(
        homepage.dex.liquidity.quoteRemoveLiquidity,
        [pool!, amount!],
        {
            enabled,
        },
    );


    