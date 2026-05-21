import { useQuery } from "@tanstack/react-query";

import { graphql, GraphQLUrlOptions } from "@shared/lib/graphql";
import QueryKey from "@shared/lib/query-keys";

export interface SystemTokenInfo {
    id: string;
    /** Display label: token symbol, or "ID: {id}" when no symbol is set */
    symbol: string;
    /** Decimal places for the system token (0 when no system token is configured). */
    precision: number;
}

interface ConfigResponse {
    config: {
        sysTid: number | null;
    } | null;
}

interface TokenResponse {
    token: {
        id: string;
        precision: number;
        /** Symbol is the account name (symbol id) returned by the Tokens GraphQL API */
        symbol?: string | null;
    } | null;
}

const NO_SYSTEM_TOKEN: SystemTokenInfo = { id: "", symbol: "", precision: 0 };

export const useSystemToken = (opts: GraphQLUrlOptions = {}) => {
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
                    ...opts,
                });

                if (!configRes.config?.sysTid) {
                    return NO_SYSTEM_TOKEN;
                }

                const sysTid = configRes.config.sysTid;
                const tokenQuery = `
                    query {
                        token(tokenId: "${sysTid}") {
                            id
                            precision
                            symbol
                        }
                    }
                `;

                const tokenRes = await graphql<TokenResponse>(tokenQuery, {
                    service: "tokens",
                    ...opts,
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
                    precision: tokenRes.token.precision,
                };
            } catch (error) {
                console.error("Error fetching system token:", error);
                return NO_SYSTEM_TOKEN;
            }
        },
    });
};
