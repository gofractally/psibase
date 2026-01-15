import { tokenSwap, usePluginFunctionQuery } from "@shared/lib/plugins";
import { Pool } from "@shared/lib/plugins/token-swap";

export const useQuotePoolTokens = (
    enabled: boolean,
    pool?: Pool,
    amount?: string,
) =>
    usePluginFunctionQuery(tokenSwap.api.quotePoolTokens, [pool!, amount!], {
        enabled,
    });
