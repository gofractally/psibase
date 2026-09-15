import { useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { producers } from "@shared/lib/plugins";

interface CandidateInfo {
    account: string;
    endpoint: string;
    claim: {
        service: string;
        rawData: number[];
    };
}

interface CandidateInfoConnection {
    edges: Array<{
        node: CandidateInfo;
    }>;
}

interface CandidatesResponse {
    allCandidates: CandidateInfoConnection;
}

export const useCandidates = () => {
    return useQuery({
        queryKey: QueryKey.candidates(),
        queryFn: async () => {
            const query = `
                query {
                    allCandidates {
                        edges {
                            node {
                                account
                                endpoint
                                claim {
                                    service
                                    rawData
                                }
                            }
                        }
                    }
                }
            `;

            const res = await graphqlAuth<CandidatesResponse>(
                producers.authorized.graphql,
                query,
            );

            return res.allCandidates.edges.map((edge) => edge.node);
        },
    });
};
