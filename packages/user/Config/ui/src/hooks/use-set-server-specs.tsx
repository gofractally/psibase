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
                            recommendedMinMemoryBytes: queryClient.getQueryData<
                                ServerSpecs & { recommendedMinMemoryBytes?: number }
                            >([...QueryKey.virtualServer(), "serverSpecs"])
                                ?.recommendedMinMemoryBytes ?? 0,
                        },
                    );
                }
            },
        },
    );
