import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { zAccount } from "@shared/lib/schemas/account";

import { graphql } from "./graphql";

export const zNft = z.object({
    id: z.number().int().positive(),
    owner: z.object({
        account: zAccount,
    }),
});

export type Evaluation = z.infer<typeof zNft>;

export const getNft = async (nftId: number) => {
    const nft = await graphql(
        `
            {
                nftDetails(nftId: ${nftId}) {
                    id
                    owner { account }
                }
            }
        `,
        siblingUrl(null, "nft", "/graphql"),
    );

    const response = z
        .object({
            nftDetails: zNft,
        })
        .parse(nft);

    return response.nftDetails;
};
