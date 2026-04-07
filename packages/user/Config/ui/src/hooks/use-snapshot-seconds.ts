import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/queryKeys";

import { graphql } from "@shared/lib/graphql";

export const SiteConfigResponse = z.object({
    snapshotInfo: z.object({
        snapshotInterval: z.number().int(),
    }),
});

export const useSnapshotSeconds = () =>
    useQuery<number>({
        queryKey: QueryKey.snapshotSeconds(),
        queryFn: async () => {
            const res = await graphql(
                `
                    {
                        snapshotInfo {
                            snapshotInterval
                        }
                    }
                `,
                { service: "transact" },
            );

            const parsed = SiteConfigResponse.parse(res);
            return parsed.snapshotInfo.snapshotInterval;
        },
    });
