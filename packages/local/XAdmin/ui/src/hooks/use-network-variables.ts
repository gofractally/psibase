import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { queryKeys } from "@/lib/query-keys";

import { graphql } from "@shared/lib/graphql";

interface NetworkVariables {
    blockReplayFactor: number;
    perBlockSysCpuNs: number;
    objStorageBytes: number;
}

const zNetworkVariablesResponse = z.object({
    getNetworkVariables: z.object({
        blockReplayFactor: z.number(),
        perBlockSysCpuNs: z.string(),
        objStorageBytes: z.string(),
    }),
});

export const useNetworkVariables = () => {
    return useQuery<NetworkVariables>({
        queryKey: [...queryKeys.configNetworkVariables],
        queryFn: async () => {
            const query = `{
                getNetworkVariables {
                    blockReplayFactor
                    perBlockSysCpuNs
                    objStorageBytes
                }
            }`;
            const res = await graphql(query, { service: "virtual-server" });

            const response = zNetworkVariablesResponse.parse(res);

            return {
                blockReplayFactor:
                    response.getNetworkVariables.blockReplayFactor,
                perBlockSysCpuNs: Number(
                    response.getNetworkVariables.perBlockSysCpuNs,
                ),
                objStorageBytes: Number(
                    response.getNetworkVariables.objStorageBytes,
                ),
            };
        },
    });
};
