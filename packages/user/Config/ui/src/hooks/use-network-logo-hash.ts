import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { config } from "@shared/lib/plugins";

export const SiteConfigResponse = z.object({
    getContent: z.object({
        edges: z
            .object({
                node: z.object({
                    path: z.string(),
                    contentHash: z.string(),
                }),
            })
            .array(),
    }),
});

/** Content hash of the uploaded network logo, or `null` if there is none */
export const useNetworkLogoHash = () =>
    useQuery({
        queryKey: QueryKey.brandingFiles(),
        queryFn: async () => {
            const res = await graphqlAuth(
                config.sites.graphql,
                `
                    {
                        getContent(account: "branding", first: 99) {
                            edges {
                                node {
                                    path
                                    contentHash
                                }
                            }
                        }
                    }
                `,
            );

            const parsed = SiteConfigResponse.parse(res);
            const logo = parsed.getContent.edges.find(
                (edge) => edge.node.path === "/network_logo",
            );
            return logo?.node.contentHash ?? null;
        },
    });
