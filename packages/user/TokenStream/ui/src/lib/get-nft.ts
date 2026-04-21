import { z } from "zod";

import { graphql } from "@shared/lib/graphql";
import { zAccount } from "@shared/lib/schemas/account";

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
        { service: "nft" },
    );

    const response = z
        .object({
            nftDetails: zNft,
        })
        .parse(nft);

    return response.nftDetails;
};
