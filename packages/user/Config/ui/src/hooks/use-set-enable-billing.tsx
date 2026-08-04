import QueryKey from "@/lib/query-keys";
import { CONFIG } from "@/lib/services";

import { queryClient } from "@shared/lib/query-client";

import { usePluginMutation } from "./use-plugin-mutation";

export const useSetEnableBilling = () =>
    usePluginMutation<[]>(
        {
            service: CONFIG,
            method: "enableBilling",
            intf: "virtualServer",
        },
        {
            error: "Failed setting enable billing",
            loading: "Setting enable billing.",
            success: "Set enable billing",
            isStagable: true,
            onSuccess: () => {
                const updater = (
                    old:
                        | { feeReceiver: string | null; enabled: boolean }
                        | undefined,
                ) => {
                    if (!old) return { feeReceiver: null, enabled: true };
                    return { ...old, enabled: true };
                };
                queryClient.setQueryData(
                    [...QueryKey.virtualServer(), "billingConfig"],
                    updater,
                );
                queryClient.setQueryData(["billingConfig"], updater);
            },
        },
    );
