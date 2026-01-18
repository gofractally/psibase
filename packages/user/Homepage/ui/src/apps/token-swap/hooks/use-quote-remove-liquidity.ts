import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { tokenSwap } from "@shared/lib/plugins";

export const useQuoteRemoveLiquidity = () =>
    usePluginFunctionMutation(tokenSwap.liquidity.quoteRemoveLiquidity);
