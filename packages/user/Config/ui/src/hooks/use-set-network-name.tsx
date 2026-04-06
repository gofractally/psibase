import { CONFIG } from "@/lib/services";

import SharedQueryKey from "@shared/lib/query-keys";
import { queryClient } from "@shared/lib/queryClient";

import { usePluginMutation } from "./use-plugin-mutation";

export const useSetNetworkName = () =>
    usePluginMutation<[string]>(
        {
            service: CONFIG,
            method: "setNetworkName",
            intf: "branding",
        },
        {
            error: "Failed setting network name",
            loading: "Setting network name..",
            success: "Set network name",
            isStagable: true,
            onSuccess: (networkName, status) => {
                if (status.type == "executed") {
                    queryClient.setQueryData(
                        SharedQueryKey.branding(),
                        networkName,
                    );
                }
            },
        },
    );
