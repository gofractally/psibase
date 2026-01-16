import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { tokenSwap } from "@shared/lib/plugins";

export const useRemoveLiquidity = () =>
    usePluginFunctionMutation(tokenSwap.liquidity.removeLiquidity, {
        toast: {
            loading: "Removing liquidity",
            error: "Failed removing liquidity",
            success: "Removed liquidity",
        },
    });
