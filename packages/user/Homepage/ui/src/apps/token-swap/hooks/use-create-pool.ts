import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { homepage } from "@shared/lib/plugins";

export const useCreatePool = () =>
    usePluginFunctionMutation(homepage.dex.liquidity.newPool, {
        toast: {
            loading: "Creating pool",
            error: "Failed creating pool",
            success: "Created pool",
        },
    });
