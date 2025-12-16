import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import { queryKeys } from "@/lib/queryKeys";

interface NetworkVariables {
    memoryRatio: number;
}

const zNetworkVariablesResponse = z.object({
    data: z.object({
        networkVariables: z.object({
            memory_ratio: z.number(),
        }),
    }),
});

export const useNetworkVariables = () => {
    return useQuery<NetworkVariables>({
        queryKey: [...queryKeys.config, "networkVariables"],
        queryFn: async () => {
            const query = `{
                networkVariables {
                    memory_ratio
                }
            }`;
            const res = await graphql(query, "virtual-server");

            const response = zNetworkVariablesResponse.parse(res);

            return {
                memoryRatio: response.data.networkVariables.memory_ratio,
            };
        },
    });
};

