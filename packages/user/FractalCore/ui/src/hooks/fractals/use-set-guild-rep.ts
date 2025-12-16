import { queryClient } from "@/queryClient";

import { fractalCorePlugin } from "@/lib/plugin";
import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const useSetGuildRep = () => {
    const fractalAccount = useFractalAccount();
    return usePluginMutation(fractalCorePlugin.adminGuild.setGuildRep, {
        error: "Failed setting guild representative",
        loading: "Setting representative",
        success: "Set representative",
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
