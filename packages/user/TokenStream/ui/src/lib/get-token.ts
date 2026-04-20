import { z } from "zod";

import { graphql } from "@shared/lib/graphql";

export const zToken = z.object({
    precision: z.number().int(),
});

export const getToken = async (tokenId: string) => {
    const token = await graphql(
        `
            {
                token(tokenId: "${tokenId}") {
                    precision
                }
            }
        `,
        { service: "tokens" },
    );

    const response = z
        .object({
            token: zToken,
        })
        .parse(token);

    return response.token;
};
