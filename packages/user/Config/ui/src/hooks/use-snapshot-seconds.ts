import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

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
                siblingUrl(null, "transact", "graphql"),
            );

            const parsed = SiteConfigResponse.parse(res);
            return parsed.snapshotInfo.snapshotInterval;
        },
    });
