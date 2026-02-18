import { siblingUrl } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

const zServerSpecs = z.object({
    netBps: z.number(),
    storageBytes: z.number(),
    recommendedMinMemoryBytes: z.number(),
});

const zServerSpecsResponse = z.object({
    getServerSpecs: zServerSpecs,
});

export type ServerSpecs = z.infer<typeof zServerSpecs>;

export const useServerSpecs = () => {
    return useQuery({
        queryKey: [...QueryKey.virtualServer(), "serverSpecs"],
        queryFn: async () => {
            const query = `
                query {
                    getServerSpecs {
                        netBps
                        storageBytes
                        recommendedMinMemoryBytes
                    }
                }
            `;

            const res = await graphql(query, siblingUrl(null, "virtual-server", "/graphql"));
            const parsed = zServerSpecsResponse.parse(res);
            return parsed.getServerSpecs;
        },
    });
};

