import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

import { siblingUrl } from "../../../../CommonApi/common/packages/common-lib/src";

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

export const useLogoUploaded = () =>
    useQuery({
        queryKey: QueryKey.brandingFiles(),
        queryFn: async () => {
            const res = await graphql(
                `
                    {
                        getContent(account: "branding", first: 99) {
                            edges {
                                node {
                                    path
                                }
                            }
                        }
                    }
                `,
                siblingUrl(null, "sites", "graphql"),
            );

            const parsed = SiteConfigResponse.parse(res);
            return parsed?.getContent.edges
                .map((edge) => edge.node.path)
                .includes("network_logo.svg");
        },
    });
