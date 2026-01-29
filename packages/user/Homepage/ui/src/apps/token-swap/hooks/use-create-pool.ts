import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { tokenSwap } from "@shared/lib/plugins";

export const useCreatePool = () =>
    usePluginFunctionMutation(tokenSwap.liquidity.newPool, {
        toast: {
            loading: "Creating pool",
            error: "Failed creating pool",
            success: "Created pool",
        },
    });
