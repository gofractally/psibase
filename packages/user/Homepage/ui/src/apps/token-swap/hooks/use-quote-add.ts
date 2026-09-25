import { homepage, usePluginFunctionQuery } from "@shared/lib/plugins";
import { Pool } from "@shared/lib/plugins/token-swap";

export const useQuoteAddLiquidity = (
    enabled: boolean,
    pool?: Pool,
    tokenId?: number,
    amount?: string,
) =>
    usePluginFunctionQuery(
        homepage.dex.liquidity.quoteAddLiquidity,
        [pool!, { amount: amount!, tokenId: tokenId! }],
        { enabled },
    );
