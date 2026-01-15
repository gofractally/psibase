import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";

interface CpuPricingParams {
    idlePpm: number;
    congestedPpm: number;
    doublingTimeSec: number;
    halvingTimeSec: number;
    numBlocksToAverage: number;
    minBillableUnitNs: number;
}

export const useSetCpuPricingParams = () =>
    usePluginMutation<[CpuPricingParams]>(
        {
            service: CONFIG,
            method: "setCpuPricingParams",
            intf: "virtualServer",
        },
        {
            error: "Failed setting CPU pricing parameters",
            loading: "Setting CPU pricing parameters",
            success: "Set CPU pricing parameters",
            isStagable: true,
            onSuccess: (_params, status) => {
                if (status.type === "executed") {
                    queryClient.invalidateQueries({
                        queryKey: [...QueryKey.virtualServer(), "cpuPricing"],
                    });
                }
            },
        },
    );

