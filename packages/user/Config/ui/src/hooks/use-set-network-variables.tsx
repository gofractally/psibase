import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import type { VirtualServerResources } from "./use-virtual-server-resources";
import { usePluginMutation } from "./use-plugin-mutation";

interface NetworkVariables {
    blockReplayFactor: number;
    perBlockSysCpuNs: number;
    objStorageBytes: number;
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
            loading: "Setting network variables",
            success: "Set network variables",
            isStagable: true,
            onSuccess: (networkVariables, status) => {
                if (status.type == "executed") {
                    queryClient.setQueryData(
                        [...QueryKey.virtualServerResources()],
                        (old: VirtualServerResources | undefined) => {
                            if (!old) return old;
                            return {
                                ...old,
                                networkVariables: networkVariables[0],
                            };
                        },
                    );
                }
            },
        },
    );

