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
                }),
            })
            .array(),
    }),
});

export const useLogoUploaded = () =>
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
                                }
                            }
                        }
                    }
                `,
            );

            const parsed = SiteConfigResponse.parse(res);
            const paths =
                parsed?.getContent.edges.map((edge) => edge.node.path) ?? [];
            return paths.some(
                (path) =>
                    path === "/network_logo.svg" ||
                    path.endsWith("network_logo.svg"),
            );
        },
    });
