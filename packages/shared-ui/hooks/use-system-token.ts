import { useQuery } from "@tanstack/react-query";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import QueryKey from "@shared/lib/query-keys";
import { tokens } from "@shared/lib/plugins";

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

export const useSystemToken = () => {
    return useQuery<SystemTokenInfo | null>({
        queryKey: QueryKey.systemToken(),
        queryFn: async (): Promise<SystemTokenInfo | null> => {
            const configQuery = `
                    query {
                        config {
                            sysTid
                        }
                    }
                `;

            const configRes = await authorizedPluginGraphql<ConfigResponse>(
                tokens.authorized.graphql,
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

            const tokenRes = await authorizedPluginGraphql<TokenResponse>(
                tokens.authorized.graphql,
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
