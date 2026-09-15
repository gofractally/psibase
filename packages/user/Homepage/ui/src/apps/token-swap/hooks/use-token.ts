import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { tokens } from "@shared/lib/plugins";
import { zAccount } from "@shared/lib/schemas/account";

export const zToken = z.object({
    precision: z.number().int(),
    symbol: zAccount.nullable(),
});

export const getToken = async (tokenId: number) => {
    const token = await graphqlAuth(
        tokens.authorized.graphql,
        `
            {
                token(tokenId: "${tokenId}") {
                    precision
                    symbol
                }
            }
        `,
    );

    const response = z
        .object({
            token: zToken,
        })
        .parse(token);

    return response.token;
};

export const useToken = (id: number | undefined) =>
    useQuery({
        queryKey: QueryKey.token(id),
        queryFn: async () => {
            return getToken(z.number().parse(id));
        },
        enabled: !!id,
    });
