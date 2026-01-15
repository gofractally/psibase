import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import { queryKeys } from "@/lib/queryKeys";

interface ServerSpecs {
    bandwidthBps: number;
    storageBytes: number;
    recommendedMinMemoryBytes: number;
}

const zServerSpecsResponse = z.union([
    // Standard GraphQL response structure
    z.object({
        data: z.object({
            getServerSpecs: z.object({
                netBps: z.string().or(z.number()),
                storageBytes: z.string().or(z.number()),
                recommendedMinMemoryBytes: z.string().or(z.number()),
            }),
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
        queryKey: [...queryKeys.config, "serverSpecs"],
        queryFn: async () => {
            const query = `{
                getServerSpecs {
                    netBps
                    storageBytes
                    recommendedMinMemoryBytes
                }
            }`;
            const res = await graphql(query, "virtual-server");

            console.log("useServerSpecs raw response:", res);

            if (res && typeof res === "object" && "errors" in res) {
                console.error("GraphQL errors:", res.errors);
                throw new Error("GraphQL query failed");
            }

            const response = zServerSpecsResponse.parse(res);
            const specs = "data" in response 
                ? response.data.getServerSpecs 
                : response.getServerSpecs;

            return {
                bandwidthBps: Number(specs.netBps),
                storageBytes: Number(specs.storageBytes),
                recommendedMinMemoryBytes: Number(specs.recommendedMinMemoryBytes),
            };
        },
    });
};

