import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const useResignRep = () => {
    const fractalAccount = useFractalAccount();
    return usePluginMutation<[guildAccount: Account]>(
        {
            intf: "adminGuild",
            method: "resignGuildRep",
            service: fractalAccount,
        },
        {
            error: "Failed resignation",
            loading: "Resigning",
            success: "Resigned",
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
