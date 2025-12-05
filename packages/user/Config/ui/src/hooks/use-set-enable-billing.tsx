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
            error: "Failed setting network name",
            loading: "Setting enable billing.",
            success: "Set enable billing",
            isStagable: true,
            onSuccess: (enabled, status) => {
                if (status.type == "executed") {
                    queryClient.setQueryData(QueryKey.virtualServer(), enabled);
                }
            },
        },
    );
