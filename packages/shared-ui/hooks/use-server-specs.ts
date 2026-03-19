import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@shared/lib/graphql";

interface ServerSpecs {
    bandwidthBps: number;
    storageBytes: number;
    recommendedMinMemoryBytes: number;
}

const zServerSpecsResponse = z.union([
    // Standard GraphQL response shape: { data: { getServerSpecs: ... } }
    z.object({
        data: z.object({
            getServerSpecs: z.object({
                netBps: z.string().or(z.number()),
                storageBytes: z.string().or(z.number()),
                recommendedMinMemoryBytes: z.string().or(z.number()),
            }),
        }),
    }),
    // Unwrapped query results: { getServerSpecs: ... }
    z.object({
        getServerSpecs: z.object({
            netBps: z.string().or(z.number()),
            storageBytes: z.string().or(z.number()),
            recommendedMinMemoryBytes: z.string().or(z.number()),
        }),
    }),
]);

export const useServerSpecs = () => {
    return useQuery<ServerSpecs>({
        queryKey: ["config", "serverSpecs"],
        queryFn: async () => {
            const query = `{
                getServerSpecs {
                    netBps
                    storageBytes
                    recommendedMinMemoryBytes
                }
            }`;

            const res = await graphql(query, { service: "virtual-server" });

            const response = zServerSpecsResponse.parse(res);
            const specs =
                "data" in response
                    ? response.data.getServerSpecs
                    : response.getServerSpecs;

            return {
                bandwidthBps: Number(specs.netBps),
                storageBytes: Number(specs.storageBytes),
                recommendedMinMemoryBytes: Number(
                    specs.recommendedMinMemoryBytes,
                ),
            };
        },
    });
};

