import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { tokenSwap } from "@shared/lib/plugins";

export const useSwap = () =>
    usePluginFunctionMutation(tokenSwap.api.swap, {
        toast: {
            loading: "Swapping",
            error: "Failed swap",
            success: "Swapped",
        },
    });
