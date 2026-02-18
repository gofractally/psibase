import { useQuery } from "@tanstack/react-query";

import { graphql } from "@shared/lib/graphql";

interface ConfigResponse {
    config?: {
        sysTid?: number;
    };
}

interface TokenResponse {
    token?: {
        id: string;
        symbol?: {
            symbolId: string;
        };
    };
}

export interface SystemTokenInfo {
    id: string;
    symbol: string;
}

export const useSystemToken = () => {
    return useQuery<SystemTokenInfo | null>({
        queryKey: ["systemToken"],
        queryFn: async () => {
            try {
                // get system token ID from config
                const configQuery = `
                    query {
                        config {
                            sysTid
                        }
                    }
                `;

                const configRes = await graphql<ConfigResponse>(
                    configQuery,
                    {service: "tokens", baseUrlIncludesSibling: false},
                );

                if (!configRes.config?.sysTid) {
                    return null;
                }

                const sysTid = configRes.config.sysTid;

                // get token details
                const tokenQuery = `
                    query {
                        token(tokenId: "${sysTid}") {
                            id
                            symbol
                        }
                    }
                `;

                const tokenRes = await graphql<TokenResponse>(
                    tokenQuery,
                    {service: "tokens", baseUrlIncludesSibling: false},
                );

                if (!tokenRes.token) {
                    return null;
                }

                return {
                    id: tokenRes.token.id.toString(),
                    symbol: tokenRes.token.symbol?.symbolId || "$SYS",
                };
            } catch (error) {
                console.error("Error fetching system token:", error);
                return null;
            }
        },
    });
};
