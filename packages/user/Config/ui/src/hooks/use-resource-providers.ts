import { useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { vserver } from "@shared/lib/plugins";

export interface ResourceProvider {
    producer: string;
    app: string;
    accepted: string[];
    endpoint: string;
}

interface ResourceProvidersResponse {
    resourceProviders: {
        edges: Array<{
            node: ResourceProvider;
        }>;
    };
}

export const useResourceProviders = () => {
    return useQuery({
        queryKey: QueryKey.resourceProviders(),
        queryFn: async () => {
            const res = await graphqlAuth<ResourceProvidersResponse>(
                vserver.authorized.graphql,
                `query {
                    resourceProviders {
                        edges {
                            node {
                                producer
                                app
                                accepted
                                endpoint
                            }
                        }
                    }
                }`,
            );

            return res.resourceProviders.edges.map((edge) => edge.node);
        },
    });
};
