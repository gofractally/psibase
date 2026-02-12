import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";

interface NetPricingParams {
    idlePct: string;
    congestedPct: string;
    doublingTimeSec: number;
    halvingTimeSec: number;
    numBlocksToAverage: number;
    minBillableUnitBits: number;
}

export const useSetNetPricingParams = () =>
    usePluginMutation<[NetPricingParams]>(
        {
            service: CONFIG,
            method: "setNetPricingParams",
            intf: "virtualServer",
        },
        {
            error: "Failed setting NET pricing parameters",
            loading: "Setting NET pricing parameters",
            success: "Set NET pricing parameters",
            isStagable: true,
            onSuccess: (_params, status) => {
                if (status.type === "executed") {
                    queryClient.invalidateQueries({
                        queryKey: [...QueryKey.virtualServer(), "netPricing"],
                    });
                }
            },
        },
    );

