import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";

export const useSetServerSpecs = () =>
    usePluginMutation<[number, number]>(
        {
            service: CONFIG,
            method: "setServerSpecs",
            intf: "virtualServer",
        },
        {
            error: "Failed setting server specs",
            loading: "Setting server specs..",
            success: "Set server specs",
            isStagable: true,
            onSuccess: (serverSpecs, status) => {
                if (status.type == "executed") {
                    queryClient.setQueryData(QueryKey.virtualServer(), serverSpecs);
                }
            },
        },
    );
