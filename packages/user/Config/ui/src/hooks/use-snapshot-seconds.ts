import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { config } from "@shared/lib/plugins";

export const SiteConfigResponse = z.object({
    snapshotInfo: z.object({
        snapshotInterval: z.number().int(),
    }),
});

export const useSnapshotSeconds = () =>
    useQuery<number>({
        queryKey: QueryKey.snapshotSeconds(),
        queryFn: async () => {
            const res = await graphqlAuth(
                config.transact.graphql,
                `
                    {
                        snapshotInfo {
                            snapshotInterval
                        }
                    }
                `,
            );

            const parsed = SiteConfigResponse.parse(res);
            return parsed.snapshotInfo.snapshotInterval;
        },
    });
