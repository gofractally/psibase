import { siblingUrl } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

interface Thresholds {
    idlePct: string;
    congestedPct: string;
}

interface NetPricingResponse {
    networkPricing: {
        numBlocksToAverage: number;
        billableUnit: number;
        pricePerUnit: number;
        halvingTimeSec: number;
        doublingTimeSec: number;
        avgUsagePct: string;
        thresholds: Thresholds;
    } | null;
}

export interface NetPricing {
    numBlocksToAverage: number;
    billableUnit: number; // in bits
    pricePerUnit: number;
    halvingTimeSec: number;
    doublingTimeSec: number;
    avgUsagePct: string;
    thresholds: Thresholds;
}

export const useNetPricing = () => {
    return useQuery({
        queryKey: [...QueryKey.virtualServer(), "netPricing"],
        queryFn: async () => {
            const query = `
                query {
                    networkPricing {
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

            const res = await graphql<NetPricingResponse>(
                query,
                siblingUrl(null, "virtual-server", "/graphql"),
            );

            if (!res.networkPricing) {
                throw new Error("Network pricing not available");
            }

            return res.networkPricing;
        },
    });
};
