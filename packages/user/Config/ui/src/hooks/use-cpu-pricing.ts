import { siblingUrl } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

const zThresholds = z.object({
    idlePct: z.string(),
    congestedPct: z.string(),
});

const zCpuPricing = z.object({
    numBlocksToAverage: z.number(),
    billableUnit: z.number(),
    pricePerUnit: z.number(),
    halvingTimeSec: z.number(),
    doublingTimeSec: z.number(),
    avgUsagePct: z.string(),
    thresholds: zThresholds,
});

const zCpuPricingResponse = z.object({
    cpuPricing: zCpuPricing.nullable(),
});

export type CpuPricing = z.infer<typeof zCpuPricing>;
export type Thresholds = z.infer<typeof zThresholds>;

export const useCpuPricing = () => {
    return useQuery({
        queryKey: [...QueryKey.virtualServerCpuPricing()],
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

            const res = await graphql(query, siblingUrl(null, "virtual-server", "/graphql"));
            const parsed = zCpuPricingResponse.parse(res);

            if (!parsed.cpuPricing) {
                throw new Error("CPU pricing not available");
            }

            return parsed.cpuPricing;
        },
    });
};
