import { useQuery } from "@tanstack/react-query";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { type PluginCall } from "@shared/lib/plugins/lib/call-plugin-function";
import QueryKey from "@shared/lib/query-keys";

export type GraphqlPluginCall = PluginCall<[query: string], string>;

export interface SystemTokenInfo {
    id: string;
    /** Display label: token symbol, or "ID: {id}" when no symbol is set */
    symbol: string;
    /** Decimal places for the system token. */
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

export const useSystemToken = (graphql: GraphqlPluginCall) => {
    return useQuery<SystemTokenInfo | null>({
        queryKey: [...QueryKey.systemToken(), graphql.service],
        queryFn: async (): Promise<SystemTokenInfo | null> => {
            const configQuery = `
                    query {
                        config {
                            sysTid
                        }
                    }
                `;

            const configRes = await callGraphqlViaPlugin<ConfigResponse>(
                graphql,
                configQuery,
            );

            if (!configRes.config?.sysTid) {
                return null;
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

            const tokenRes = await callGraphqlViaPlugin<TokenResponse>(
                graphql,
                tokenQuery,
            );

            if (!tokenRes.token) {
                return null;
            }

            const idStr = tokenRes.token.id.toString();
            const symbol = tokenRes.token.symbol?.trim() ?? `ID: ${idStr}`;

            return {
                id: idStr,
                symbol,
                precision: tokenRes.token.precision,
            };
        },
    });
};
