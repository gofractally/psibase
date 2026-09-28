import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { homepage } from "@shared/lib/plugins";

export const useSwap = () =>
    usePluginFunctionMutation(homepage.dex.swap.swap, {
        toast: {
            loading: "Swapping",
            error: "Failed swap",
            success: "Swapped",
        },
    });
