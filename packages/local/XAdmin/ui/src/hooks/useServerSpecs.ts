import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import { queryKeys } from "@/lib/queryKeys";

interface ServerSpecs {
    bandwidthBps: number;
    storageBytes: number;
}

const zServerSpecsResponse = z.object({
    data: z.object({
        serverSpecs: z.object({
            bandwidth_bps: z.string(),
            storage_bytes: z.string(),
        }),
    }),
});

export const useServerSpecs = () => {
    return useQuery<ServerSpecs>({
        queryKey: [...queryKeys.config, "serverSpecs"],
        queryFn: async () => {
            const query = `{
                serverSpecs {
                    bandwidth_bps
                    storage_bytes
                }
            }`;
            const res = await graphql(query, "virtual-server");

            const response = zServerSpecsResponse.parse(res);

            return {
                bandwidthBps: Number(response.data.serverSpecs.bandwidth_bps),
                storageBytes: Number(response.data.serverSpecs.storage_bytes),
            };
        },
    });
};

