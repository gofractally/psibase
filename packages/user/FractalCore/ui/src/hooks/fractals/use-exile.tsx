import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { Account } from "@/lib/zod/Account";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const useExile = () => {
    const fractalAccount = useFractalAccount();
    return usePluginMutation<[member: Account]>(
        {
            intf: "adminFractal",
            method: "exileMember",
            service: fractalAccount,
        },
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
