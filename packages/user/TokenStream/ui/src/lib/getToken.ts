import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "./graphql";

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
        siblingUrl(null, "tokens", "/graphql"),
    );

    const response = z
        .object({
            token: zToken,
        })
        .parse(token);

    return response.token;
};
