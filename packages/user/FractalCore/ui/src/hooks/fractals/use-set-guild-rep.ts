import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const useSetGuildRep = () => {
    const fractalAccount = useFractalAccount();
    return usePluginMutation<[guildAccount: Account, newRep: Account]>(
        {
            intf: "adminGuild",
            method: "setGuildRep",
            service: fractalAccount,
        },
        {
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
        },
    );
};
