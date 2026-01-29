import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/queryKeys";



import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@shared/lib/graphql";

export const zToken = z.object({
    precision: z.number().int(),
});

export const getToken = async (tokenId: number) => {
    const token = await graphql(
        `
            {
                token(tokenId: "${tokenId}") {
                    precision
                }
            }
        `,
        siblingUrl(null, "tokens", "/graphql"),
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
