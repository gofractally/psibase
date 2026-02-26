import { useQuery } from "@tanstack/react-query";

import { graphql } from "@shared/lib/graphql";
import QueryKey from "@shared/lib/query-keys";

export interface SystemTokenInfo {
    id: string;
    /** Display label: token symbol, or "ID: {id}" when no symbol is set */
    symbol: string;
}

interface ConfigResponse {
    config: {
        sysTid: number | null;
    } | null;
}

interface TokenResponse {
    token: {
        id: string;
        /** Symbol is the account name (symbol id) returned by the Tokens GraphQL API */
        symbol?: string | null;
    } | null;
}

const NO_SYSTEM_TOKEN: SystemTokenInfo = { id: "", symbol: "" };

export const useSystemToken = () => {
    return useQuery<SystemTokenInfo>({
        queryKey: QueryKey.systemToken(),
        queryFn: async (): Promise<SystemTokenInfo> => {
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
                    return NO_SYSTEM_TOKEN;
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
                    return NO_SYSTEM_TOKEN;
                }

                const idStr = tokenRes.token.id.toString();
                const symbol =
                    tokenRes.token.symbol?.trim() ?? `ID: ${idStr}`;

                return {
                    id: idStr,
                    symbol,
                };
            } catch (error) {
                console.error("Error fetching system token:", error);
                return NO_SYSTEM_TOKEN;
            }
        },
    });
};
