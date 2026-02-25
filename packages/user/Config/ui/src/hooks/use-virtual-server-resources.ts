import { siblingUrl } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";
// import { CpuPricing, NetPricing } from "./use-resource-pricing";

const zServerSpecs = z.object({
    netBps: z.number(),
    storageBytes: z.number(),
    recommendedMinMemoryBytes: z.number(),
});

const zNetworkVariables = z.object({
    blockReplayFactor: z.number(),
    perBlockSysCpuNs: z.number(),
    objStorageBytes: z.number(),
});

const zCpuPricing = z.object({
    availableUnits: z.number(),
});

const zNetPricing = z.object({
    availableUnits: z.number(),
});

const zResourcesResponse = z.object({
    getServerSpecs: zServerSpecs,
    getNetworkVariables: zNetworkVariables,
    cpuPricing: zCpuPricing.nullable(),
    networkPricing: zNetPricing.nullable(),
});

export type ServerSpecs = z.infer<typeof zServerSpecs>;
export type NetworkVariables = z.infer<typeof zNetworkVariables>;

export interface VirtualServerResources {
    serverSpecs: ServerSpecs;
    networkVariables: NetworkVariables;
    cpuAvailableUnits: number;
    netAvailableUnits: number;
}

export const useVirtualServerResources = () => {
    return useQuery({
        queryKey: [...QueryKey.virtualServerResources()],
        queryFn: async (): Promise<VirtualServerResources> => {
            const query = `
                query {
                    getServerSpecs {
                        netBps
                        storageBytes
                        recommendedMinMemoryBytes
                    }
                    getNetworkVariables {
                        blockReplayFactor
                        perBlockSysCpuNs
                        objStorageBytes
                    }
                    networkPricing {
                        availableUnits
                    }
                    cpuPricing {
                        availableUnits
                    }
                }
            `;

            const res = await graphql(
                query,
                siblingUrl(null, "virtual-server", "/graphql"),
            );
            const parsed = zResourcesResponse.parse(res);
            return {
                serverSpecs: parsed.getServerSpecs,
                networkVariables: parsed.getNetworkVariables,
                cpuAvailableUnits: parsed.cpuPricing?.availableUnits ?? 0,
                netAvailableUnits: parsed.networkPricing?.availableUnits ?? 0,
            };
        },
    });
};
