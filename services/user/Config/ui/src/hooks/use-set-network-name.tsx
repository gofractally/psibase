import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "./use-plugin-mutation";

export const useSetNetworkName = () =>
    usePluginMutation<string>(
        {
            service: "config",
            intf: "app",
            method: "setNetworkName",
        },
        {
            error: "Failed setting network name",
            loading: "Setting network name..",
            success: "Set network name",
            isStagable: true,
            onSuccess: (networkName, status) => {
                if (status.type == "executed") {
                    queryClient.setQueryData(QueryKey.branding(), networkName);
                }
            },
        },
    );
