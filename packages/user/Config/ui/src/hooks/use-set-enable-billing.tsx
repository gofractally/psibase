import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";

export const useSetEnableBilling = () =>
    usePluginMutation<[boolean]>(
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
            onSuccess: (enabled, status) => {
                if (status.type == "executed") {
                    queryClient.setQueryData(
                        [...QueryKey.virtualServer(), "billingConfig"],
                        (old: { feeReceiver: string | null; enabled: boolean } | undefined) => {
                            if (!old) return { feeReceiver: null, enabled };
                            return { ...old, enabled };
                        },
                    );
                }
            },
        },
    );
