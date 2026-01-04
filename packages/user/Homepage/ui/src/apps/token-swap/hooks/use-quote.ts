import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";
import { tokenSwap } from "@shared/lib/plugins";

export const useQuote = (
    fromToken?: number,
    amount?: string,
    toToken?: number,
) => {
    const isAmountValid = !amount?.endsWith(".");
    return usePluginFunctionQuery(
        tokenSwap.api.getAmount,
        [fromToken!, amount!, toToken!, 4],
        { enabled: !!(fromToken && amount && toToken && isAmountValid) },
    );
};
