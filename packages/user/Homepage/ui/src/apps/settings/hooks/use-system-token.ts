import { useQuery } from "@tanstack/react-query";

import { graphql } from "@/lib/graphql";
import { zAccount } from "@/lib/zod/Account";

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
                // First, get the system token ID from config
                const configQuery = `
                    query {
                        config {
                            sysTid
                        }
                    }
                `;

                const configRes = await graphql<ConfigResponse>(
                    configQuery,
                    zAccount.parse("tokens"),
                );

                if (!configRes.config?.sysTid) {
                    return null;
                }

                const sysTid = configRes.config.sysTid;

                // Then, get the token details
                const tokenQuery = `
                    query {
                        token(tokenId: "${sysTid}") {
                            id
                            symbol {
                                symbolId
                            }
                        }
                    }
                `;

                const tokenRes = await graphql<TokenResponse>(
                    tokenQuery,
                    zAccount.parse("tokens"),
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
