import { useQuery } from "@tanstack/react-query";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

interface NetworkVariables {
    blockReplayFactor: number;
    perBlockSysCpuNs: number;
    objStorageBytes: number;
    memoryRatio: number;
}

interface NetworkVariablesResponse {
    getNetworkVariables: NetworkVariables;
}

export const useNetworkVariables = () => {
    return useQuery({
        queryKey: [...QueryKey.virtualServer(), "networkVariables"],
        queryFn: async () => {
            const query = `
                query {
                    getNetworkVariables {
                        blockReplayFactor
                        perBlockSysCpuNs
                        objStorageBytes
                        memoryRatio
                    }
                }
            `;

            const res = await graphql<NetworkVariablesResponse>(
                query,
                siblingUrl(null, "virtual-server", "/graphql"),
            );

            return res.getNetworkVariables;
        },
    });
};

