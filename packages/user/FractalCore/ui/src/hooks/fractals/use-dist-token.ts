import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const useDistToken = () => {
    const fractalAccount = useFractalAccount();
    return usePluginMutation<[]>(
        {
            intf: "userFractal",
            method: "distToken",
            service: fractalAccount,
        },
        {
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
        },
    );
};
