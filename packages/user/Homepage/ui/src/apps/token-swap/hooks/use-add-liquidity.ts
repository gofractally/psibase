import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { tokenSwap } from "@shared/lib/plugins";

export const useAddLiquidity = () =>
    usePluginFunctionMutation(tokenSwap.api.addLiquidity, {
        toast: {
            loading: "Adding liquidity",
            error: "Failed adding liquidity",
            success: "Added liquidity",
        },
    });
