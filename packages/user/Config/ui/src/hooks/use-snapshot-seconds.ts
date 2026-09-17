import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { transact } from "@shared/lib/plugins";

export const SiteConfigResponse = z.object({
    snapshotInfo: z.object({
        snapshotInterval: z.number().int(),
    }),
});

export const useSnapshotSeconds = () =>
    useQuery<number>({
        queryKey: QueryKey.snapshotSeconds(),
        queryFn: async () => {
            const res = await callGraphqlViaPlugin(
                transact.authorized.graphql,
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
