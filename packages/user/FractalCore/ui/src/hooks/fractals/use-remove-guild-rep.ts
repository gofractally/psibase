import { queryClient } from "@/queryClient";

import { fractalCorePlugin } from "@/lib/plugin";
import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const useRemoveGuildRep = () => {
    const fractalAccount = useFractalAccount();
    return usePluginMutation(fractalCorePlugin.adminGuild.removeGuildRep, {
        error: "Failed removing guild representative",
        loading: "Removing guild representative",
        success: "Removed guild representative",
        isStagable: true,
        onSuccess: ([guildAccount], status) => {
            if (status.type == "executed") {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.fractal(fractalAccount),
                });
                queryClient.invalidateQueries({
                    queryKey: QueryKey.fractals(),
                });
                queryClient.invalidateQueries({
                    queryKey: QueryKey.guild(guildAccount),
                });
            }
        },
    });
};
