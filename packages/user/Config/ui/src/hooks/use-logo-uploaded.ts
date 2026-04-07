import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/queryKeys";

import { graphql } from "@shared/lib/graphql";

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
                { service: "sites" },
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
