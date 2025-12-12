import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const useRemoveGuildRep = () => {
    const fractalAccount = useFractalAccount();
    return usePluginMutation<[guildAccount: Account]>(
        {
            intf: "adminGuild",
            method: "removeGuildRep",
            service: fractalAccount,
        },
        {
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
        },
    );
};
