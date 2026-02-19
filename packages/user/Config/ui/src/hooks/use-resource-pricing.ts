import { siblingUrl } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

const zThresholds = z.object({
    idlePct: z.string(),
    congestedPct: z.string(),
});

const zPricing = z.object({
    numBlocksToAverage: z.number(),
    billableUnit: z.number(),
    pricePerUnit: z.number(),
    halvingTimeSec: z.number(),
    doublingTimeSec: z.number(),
    avgUsagePct: z.string(),
    thresholds: zThresholds,
});

const zPricingResponse = z.object({
    cpuPricing: zPricing.nullable(),
    networkPricing: zPricing.nullable(),
});

export type CpuPricing = z.infer<typeof zPricing>;
export type NetPricing = z.infer<typeof zPricing>;
export type Thresholds = z.infer<typeof zThresholds>;

export interface ResourcePricing {
    cpuPricing: CpuPricing;
    netPricing: NetPricing;
}

export const useResourcePricing = () => {
    return useQuery({
        queryKey: [...QueryKey.virtualServerPricing()],
        queryFn: async (): Promise<ResourcePricing> => {
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

            const res = await graphql(
                query,
                siblingUrl(null, "virtual-server", "/graphql"),
            );
            const parsed = zPricingResponse.parse(res);

            if (!parsed.cpuPricing) {
                throw new Error("CPU pricing not available");
            }
            if (!parsed.networkPricing) {
                throw new Error("Network pricing not available");
            }

            return {
                cpuPricing: parsed.cpuPricing,
                netPricing: parsed.networkPricing,
            };
        },
    });
};
