import { queryClient } from "@/queryClient";

import { fractalCorePlugin } from "@/lib/constants";
import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

import { usePluginMutation } from "../use-plugin-mutation";

export const useExile = () => {
    return usePluginMutation<[member: Account]>(
        fractalCorePlugin.adminFractal.exileMember,
        {
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
        },
    );
};
