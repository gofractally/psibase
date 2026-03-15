import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import type { VirtualServerResources } from "./use-virtual-server-resources";
import { usePluginMutation } from "./use-plugin-mutation";

interface ServerSpecs {
    netBps: number;
    storageBytes: number;
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
                        [...QueryKey.virtualServerResources()],
                        (old: VirtualServerResources | undefined) => {
                            if (!old) return old;
                            const recommendedMinMemoryBytes =
                                old.serverSpecs?.recommendedMinMemoryBytes ?? 0;
                            return {
                                ...old,
                                serverSpecs: {
                                    ...serverSpecs[0],
                                    recommendedMinMemoryBytes,
                                },
                            };
                        },
                    );
                }
            },
        },
    );
