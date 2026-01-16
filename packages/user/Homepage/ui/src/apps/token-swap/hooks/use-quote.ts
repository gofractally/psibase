import { usePluginFunctionQuery } from "@shared/lib/plugins";
import { tokenSwap } from "@shared/lib/plugins";

export const useQuote = (
    enabled: boolean,
    fromToken?: number,
    amount?: string,
    toToken?: number,
    slippageTolerance?: number,
) => {
    const isAmountValid = !amount?.endsWith(".");
    return usePluginFunctionQuery(
        tokenSwap.swap.getAmount,
        [fromToken!, amount!, toToken!, (slippageTolerance || 0) * 1000000, 3],
        {
            enabled: !!(
                fromToken &&
                amount &&
                toToken &&
                isAmountValid &&
                enabled
            ),
        },
    );
};
