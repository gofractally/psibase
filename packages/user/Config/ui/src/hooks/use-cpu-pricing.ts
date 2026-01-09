import { siblingUrl } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

interface Thresholds {
    idlePct: string;
    congestedPct: string;
}

interface CpuPricingResponse {
    cpuPricing: {
        numBlocksToAverage: number;
        billableUnit: number;
        pricePerUnit: number;
        halvingTimeSec: number;
        doublingTimeSec: number;
        avgUsagePct: string;
        thresholds: Thresholds;
    } | null;
}

export interface CpuPricing {
    numBlocksToAverage: number;
    billableUnit: number; // in nanoseconds
    pricePerUnit: number;
    halvingTimeSec: number;
    doublingTimeSec: number;
    avgUsagePct: string;
    thresholds: Thresholds;
}

export const useCpuPricing = () => {
    return useQuery({
        queryKey: [...QueryKey.virtualServer(), "cpuPricing"],
        queryFn: async () => {
            const query = `
                query {
                    cpuPricing {
                        numBlocksToAverage
                        billableUnit
                        pricePerUnit
                        halvingTimeSec
                        doublingTimeSec
                        avgUsagePct
                        thresholds {
                            idlePct
                            congestedPct
                        }
                    }
                }
            `;

            const res = await graphql<CpuPricingResponse>(
                query,
                siblingUrl(null, "virtual-server", "/graphql"),
            );

            if (!res.cpuPricing) {
                throw new Error("CPU pricing not available");
            }

            return res.cpuPricing;
        },
    });
};
