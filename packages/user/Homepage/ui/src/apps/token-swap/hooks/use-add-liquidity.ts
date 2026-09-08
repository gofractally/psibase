import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { homepage } from "@shared/lib/plugins";

export const useAddLiquidity = () =>
    usePluginFunctionMutation(homepage.dex.liquidity.addLiquidity, {
        toast: {
            loading: "Adding liquidity",
            error: "Failed adding liquidity",
            success: "Added liquidity",
        },
    });
