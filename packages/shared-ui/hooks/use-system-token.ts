import { useQuery } from "@tanstack/react-query";

import { graphql } from "@shared/lib/graphql";
import QueryKey from "@shared/lib/query-keys";

export interface SystemTokenInfo {
    id: string;
    symbol?: string;
}

interface ConfigResponse {
    config: {
        sysTid: number | null;
    } | null;
}

interface TokenResponse {
    token: {
        id: string;
        symbol?: {
            symbolId: string;
        } | null;
    } | null;
}

export const useSystemToken = () => {
    return useQuery<SystemTokenInfo | null>({
        queryKey: QueryKey.systemToken(),
        queryFn: async () => {
            try {
                const configQuery = `
                    query {
                        config {
                            sysTid
                        }
                    }
                `;

                const configRes = await graphql<ConfigResponse>(configQuery, {
                    service: "tokens",
                });

                if (!configRes.config?.sysTid) {
                    return null;
                }

                const sysTid = configRes.config.sysTid;
                const tokenQuery = `
                    query {
                        token(tokenId: "${sysTid}") {
                            id
                            symbol
                        }
                    }
                `;

                const tokenRes = await graphql<TokenResponse>(tokenQuery, {
                    service: "tokens",
                });

                if (!tokenRes.token) {
                    return null;
                }

                return {
                    id: tokenRes.token.id.toString(),
                    symbol: tokenRes.token.symbol?.symbolId,
                };
            } catch (error) {
                console.error("Error fetching system token:", error);
                return null;
            }
        },
    });
};
