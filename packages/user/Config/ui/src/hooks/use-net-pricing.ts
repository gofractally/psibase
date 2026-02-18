import { siblingUrl } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

const zThresholds = z.object({
    idlePct: z.string(),
    congestedPct: z.string(),
});

const zNetPricing = z.object({
    numBlocksToAverage: z.number(),
    billableUnit: z.number(),
    pricePerUnit: z.number(),
    halvingTimeSec: z.number(),
    doublingTimeSec: z.number(),
    avgUsagePct: z.string(),
    thresholds: zThresholds,
});

const zNetPricingResponse = z.object({
    networkPricing: zNetPricing.nullable(),
});

export type NetPricing = z.infer<typeof zNetPricing>;
export type Thresholds = z.infer<typeof zThresholds>;

export const useNetPricing = () => {
    return useQuery({
        queryKey: [...QueryKey.virtualServerNetPricing()],
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

            const res = await graphql(query, siblingUrl(null, "virtual-server", "/graphql"));
            const parsed = zNetPricingResponse.parse(res);

            if (!parsed.networkPricing) {
                throw new Error("Network pricing not available");
            }

            return parsed.networkPricing;
        },
    });
};
