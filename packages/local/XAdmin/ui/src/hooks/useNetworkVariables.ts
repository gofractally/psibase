import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import { queryKeys } from "@/lib/queryKeys";

interface NetworkVariables {
    blockReplayFactor: number;
    perBlockSysCpuNs: number;
    objStorageBytes: number;
}

const zNetworkVariablesResponse = z.object({
    data: z.object({
        getNetworkVariables: z.object({
            blockReplayFactor: z.number(),
            perBlockSysCpuNs: z.string(),
            objStorageBytes: z.string(),
        }),
    }),
});

export const useNetworkVariables = () => {
    return useQuery<NetworkVariables>({
        queryKey: [...queryKeys.config, "networkVariables"],
        queryFn: async () => {
            const query = `{
                getNetworkVariables {
                    blockReplayFactor
                    perBlockSysCpuNs
                    objStorageBytes
                }
            }`;
            const res = await graphql(query, "virtual-server");

            const response = zNetworkVariablesResponse.parse(res);

            return {
                blockReplayFactor: response.data.getNetworkVariables.blockReplayFactor,
                perBlockSysCpuNs: Number(
                    response.data.getNetworkVariables.perBlockSysCpuNs,
                ),
                objStorageBytes: Number(
                    response.data.getNetworkVariables.objStorageBytes,
                ),
            };
        },
    });
};

