import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@shared/lib/graphql";

interface NetworkVariables {
    blockReplayFactor: number;
    perBlockSysCpuNs: number;
    objStorageBytes: number;
    // VirtualServer currently derives `recommendedMinMemoryBytes` as:
    //   serverSpecs.storageBytes / memoryRatio
    // but it isn't exposed directly via `getNetworkVariables`, so we derive
    // `memoryRatio` from `getServerSpecs` to keep existing UI code working.
    memoryRatio: number;
}

const zNetworkVariablesResponse = z.union([
    // Standard GraphQL response shape: { data: { getNetworkVariables: ... } }
    z.object({
        data: z.object({
            getServerSpecs: z.object({
                storageBytes: z.string().or(z.number()),
                recommendedMinMemoryBytes: z.string().or(z.number()),
            }),
            getNetworkVariables: z.object({
                blockReplayFactor: z.number(),
                perBlockSysCpuNs: z.string().or(z.number()),
                objStorageBytes: z.string().or(z.number()),
            }),
        }),
    }),
    // Unwrapped query results: { getNetworkVariables: ... }
    z.object({
        getServerSpecs: z.object({
            storageBytes: z.string().or(z.number()),
            recommendedMinMemoryBytes: z.string().or(z.number()),
        }),
        getNetworkVariables: z.object({
            blockReplayFactor: z.number(),
            perBlockSysCpuNs: z.string().or(z.number()),
            objStorageBytes: z.string().or(z.number()),
        }),
    }),
]);

export const useNetworkVariables = () => {
    return useQuery<NetworkVariables>({
        queryKey: ["config", "networkVariables"],
        queryFn: async () => {
            const query = `{
                getServerSpecs {
                    storageBytes
                    recommendedMinMemoryBytes
                }
                getNetworkVariables {
                    blockReplayFactor
                    perBlockSysCpuNs
                    objStorageBytes
                }
            }`;

            const res = await graphql(query, { service: "virtual-server" });
            const response = zNetworkVariablesResponse.parse(res);
            const vars =
                "data" in response
                    ? response.data
                    : response;

            return {
                blockReplayFactor: vars.getNetworkVariables.blockReplayFactor,
                perBlockSysCpuNs: Number(
                    vars.getNetworkVariables.perBlockSysCpuNs,
                ),
                objStorageBytes: Number(vars.getNetworkVariables.objStorageBytes),
                memoryRatio:
                    Number(vars.getServerSpecs.storageBytes) /
                    Number(vars.getServerSpecs.recommendedMinMemoryBytes),
            };
        },
    });
};

