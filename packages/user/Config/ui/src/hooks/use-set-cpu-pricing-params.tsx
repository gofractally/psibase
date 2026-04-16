import QueryKey from "@/lib/query-keys";
import { CONFIG } from "@/lib/services";

import { queryClient } from "@shared/lib/query-client";

import { usePluginMutation } from "./use-plugin-mutation";

interface CpuPricingParams {
    idlePct: string;
    congestedPct: string;
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
                        queryKey: [...QueryKey.virtualServerPricing()],
                    });
                }
            },
        },
    );
