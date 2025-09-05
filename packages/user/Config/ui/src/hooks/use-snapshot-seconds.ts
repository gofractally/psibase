import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

// import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

// import { siblingUrl } from "../../../../CommonApi/common/packages/common-lib/src";

export const SiteConfigResponse = z.object({
    getContent: z.object({
        edges: z
            .object({
                node: z.object({
                    path: z.string(),
                }),
            })
            .array(),
    }),
});

export const useSnapshotSeconds = () =>
    useQuery<number>({
        queryKey: QueryKey.snapshotSeconds(),
        queryFn: async () => {
            // const res = await graphql(
            //     `
            //         {
            //             getContent(account: "branding", first: 99) {
            //                 edges {
            //                     node {
            //                         path
            //                     }
            //                 }
            //             }
            //         }
            //     `,
            //     siblingUrl(null, "sites", "graphql"),
            // );

            // console.log(res, "res");
            // const parsed = SiteConfigResponse.parse(res);
            return 86400;
        },
    });
