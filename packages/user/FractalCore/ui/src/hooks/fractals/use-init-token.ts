import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const useInitToken = () => {
    const fractalAccount = useFractalAccount();
    return usePluginMutation<[]>(
        {
            intf: "adminFractal",
            method: "initToken",
            service: fractalAccount,
        },
        {
            error: "Failed token intialization",
            loading: "Intializating token",
            success: "Initialized token",
            isStagable: true,
            onSuccess: (_, status) => {
                if (status.type == "executed") {
                    queryClient.invalidateQueries({
                        queryKey: QueryKey.fractal(fractalAccount),
                    });
                    queryClient.invalidateQueries({
                        queryKey: QueryKey.fractals(),
                    });
                }
            },
        },
    );
};
