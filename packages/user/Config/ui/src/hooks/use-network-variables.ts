import { siblingUrl } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

const zNetworkVariables = z.object({
    blockReplayFactor: z.number(),
    perBlockSysCpuNs: z.number(),
    objStorageBytes: z.number(),
});

const zNetworkVariablesResponse = z.object({
    getNetworkVariables: zNetworkVariables,
});

export type NetworkVariables = z.infer<typeof zNetworkVariables>;

export const useNetworkVariables = () => {
    return useQuery({
        queryKey: [...QueryKey.virtualServerNetworkVariables()],
        queryFn: async () => {
            const query = `
                query {
                    getNetworkVariables {
                        blockReplayFactor
                        perBlockSysCpuNs
                        objStorageBytes
                    }
                }
            `;

            const res = await graphql(query, siblingUrl(null, "virtual-server", "/graphql"));
            const parsed = zNetworkVariablesResponse.parse(res);
            return parsed.getNetworkVariables;
        },
    });
};

