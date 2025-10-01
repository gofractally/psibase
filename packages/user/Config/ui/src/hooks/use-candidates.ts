import { useQuery } from "@tanstack/react-query";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

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
        cursor: string;
    }>;
    pageInfo: {
        hasPreviousPage: boolean;
        hasNextPage: boolean;
        startCursor: string;
        endCursor: string;
    };
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
                            cursor
                        }
                        pageInfo {
                            hasPreviousPage
                            hasNextPage
                            startCursor
                            endCursor
                        }
                    }
                }
            `;

            const res = await graphql<CandidatesResponse>(
                query,
                siblingUrl(null, "producers", "/graphql"),
            );

            return res.allCandidates.edges.map((edge) => edge.node);
        },
    });
};
