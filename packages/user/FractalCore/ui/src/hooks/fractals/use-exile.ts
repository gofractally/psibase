import { queryClient } from "@/queryClient";

import { fractalCorePlugin } from "@/lib/plugin";
import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "../use-plugin-mutation";

export const useExile = () =>
    usePluginMutation(fractalCorePlugin.adminFractal.exileMember, {
        error: "Failed exile",
        loading: "Exiling member",
        success: "Exiled member",
        isStagable: true,
        onSuccess: ([fractal], status) => {
            if (status.type == "executed") {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.members(fractal),
                });
            }
        },
    });
