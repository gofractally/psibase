import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { queryKeys } from "@/lib/query-keys";

import { adminGraphql } from "@/lib/admin-graphql";

import { useChainReady } from "./use-statuses";

interface NetworkVariables {
    blockReplayFactor: number;
    perBlockSysCpuNs: number;
    objStorageBytes: number;
    subjStorageBytes: number;
}

const zNetworkVariablesResponse = z.object({
    getNetworkVariables: z.object({
        blockReplayFactor: z.number(),
        perBlockSysCpuNs: z.string(),
        objStorageBytes: z.string(),
        subjStorageBytes: z.string(),
    }),
});

export const useNetworkVariables = () => {
    const chainReady = useChainReady();
    return useQuery<NetworkVariables>({
        queryKey: [...queryKeys.configNetworkVariables],
        queryFn: async () => {
            const query = `{
                getNetworkVariables {
                    blockReplayFactor
                    perBlockSysCpuNs
                    objStorageBytes
                    subjStorageBytes
                }
            }`;
            const res = await adminGraphql(query, { service: "vserver" });

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
                subjStorageBytes: Number(
                    response.getNetworkVariables.subjStorageBytes,
                ),
            };
        },
        enabled: chainReady,
    });
};
