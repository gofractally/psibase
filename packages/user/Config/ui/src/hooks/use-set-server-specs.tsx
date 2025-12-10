import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";

interface ServerSpecs {
    netBps: number; // bytes per second
    storageBytes: number; // bytes
}

export const useSetServerSpecs = () =>
    usePluginMutation<[ServerSpecs]>(
        {
            service: CONFIG,
            method: "setSpecs",
            intf: "virtualServer",
        },
        {
            error: "Failed setting server specs",
            loading: "Setting server specs..",
            success: "Set server specs",
            isStagable: true,
            onSuccess: (serverSpecs, status) => {
                if (status.type == "executed") {
                    queryClient.setQueryData(
                        [...QueryKey.virtualServer(), "serverSpecs"],
                        {
                            ...serverSpecs[0],
                            // useServerSpecs also returns minMemoryBytes, preserve it if it exists
                            minMemoryBytes: queryClient.getQueryData<ServerSpecs & { minMemoryBytes?: number }>(
                                [...QueryKey.virtualServer(), "serverSpecs"]
                            )?.minMemoryBytes ?? 0,
                        },
                    );
                }
            },
        },
    );
