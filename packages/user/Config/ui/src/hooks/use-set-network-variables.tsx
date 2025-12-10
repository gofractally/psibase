import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";

interface NetworkVariables {
    blockReplayFactor: number;
    perBlockSysCpuNs: number;
    objStorageBytes: number;
    memoryRatio: number;
}

export const useSetNetworkVariables = () =>
    usePluginMutation<[NetworkVariables]>(
        {
            service: CONFIG,
            method: "setNetworkVariables",
            intf: "virtualServer",
        },
        {
            error: "Failed setting network variables",
            loading: "Setting network variables..",
            success: "Set network variables",
            isStagable: true,
            onSuccess: (networkVariables, status) => {
                if (status.type == "executed") {
                    queryClient.setQueryData(
                        [...QueryKey.virtualServer(), "networkVariables"],
                        networkVariables[0],
                    );
                }
            },
        },
    );

