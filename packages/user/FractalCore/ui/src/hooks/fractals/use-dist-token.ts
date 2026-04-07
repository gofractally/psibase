import { fractalCorePlugin } from "@/lib/plugin";
import QueryKey from "@/lib/queryKeys";

import { queryClient } from "@shared/lib/query-client";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const useDistToken = () => {
    const fractalAccount = useFractalAccount();
    return usePluginMutation(fractalCorePlugin.userFractal.distToken, {
        error: "Failed token distribution",
        loading: "Distributing",
        success: "Distributed tokens",
        isStagable: true,
        onSuccess: (_, status) => {
            if (status.type == "executed") {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.fractal(fractalAccount),
                });
            }
        },
    });
};
