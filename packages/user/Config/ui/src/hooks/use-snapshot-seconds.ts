import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

import { siblingUrl } from "../../../../CommonApi/common/packages/common-lib/src";

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
