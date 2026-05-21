import { useQuery } from "@tanstack/react-query";

import { zTokenQueryData } from "@/apps/prem-accounts/lib/graphql/prem-accounts.schemas";
import QueryKey from "@/lib/query-keys";

import { graphql } from "@shared/lib/graphql";
import { supervisor } from "@shared/lib/supervisor";

export type PremSystemToken = {
    id: number;
    precision: number;
    symbol?: string;
};

export const usePremSystemToken = () =>
    useQuery({
        queryKey: QueryKey.premSystemToken(),
        queryFn: async (): Promise<PremSystemToken | null> => {
            const sysTidRaw = (await supervisor.functionCall({
                service: "tokens",
                plugin: "plugin",
                intf: "helpers",
                method: "fetchNetworkToken",
                params: [],
            })) as number | bigint | null;

            if (!sysTidRaw) {
                return null;
            }

            const sysTid =
                typeof sysTidRaw === "bigint" ? Number(sysTidRaw) : sysTidRaw;

            const raw = await graphql(
                `
                    {
                        token(tokenId: "${sysTid}") {
                            precision
                            symbol
                        }
                    }
                `,
                { service: "tokens" },
            );
            const { token } = zTokenQueryData.parse(raw);

            if (!token) {
                return null;
            }

            return {
                id: sysTid,
                precision: token.precision,
                symbol: token.symbol ?? undefined,
            };
        },
    });
