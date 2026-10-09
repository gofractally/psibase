import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { homepage } from "@shared/lib/plugins";

export const useRemoveLiquidity = () =>
    usePluginFunctionMutation(homepage.dex.liquidity.removeLiquidity, {
        toast: {
            loading: "Removing liquidity",
            error: "Failed removing liquidity",
            success: "Removed liquidity",
        },
    });
