import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { queryKeys } from "@/lib/query-keys";

import { graphql } from "@shared/lib/graphql";

interface ServerSpecs {
    bandwidthBps: number;
    storageBytes: number;
    recommendedMinMemoryBytes: number;
}

const zServerSpecsResponse = z.union([
    // Standard GraphQL response structure
    z.object({
        getServerSpecs: z.object({
            netBps: z.string().or(z.number()),
            storageBytes: z.string().or(z.number()),
            recommendedMinMemoryBytes: z.string().or(z.number()),
        }),
    }),
    // Unwrapped query results
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
        queryKey: [...queryKeys.configServerSpecs],
        queryFn: async () => {
            const query = `{
                getServerSpecs {
                    netBps
                    storageBytes
                    recommendedMinMemoryBytes
                }
            }`;
            const res = await graphql(query, { service: "virtual-server" });

            if (res && typeof res === "object" && "errors" in res) {
                console.error("GraphQL errors:", res.errors);
                throw new Error("GraphQL query failed");
            }

            const response = zServerSpecsResponse.parse(res);
            const specs = response.getServerSpecs;

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
