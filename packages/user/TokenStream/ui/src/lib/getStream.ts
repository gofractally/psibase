import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "./graphql";

export const zStream = z.object({
    nftId: z.number().int().positive(),
    tokenId: z.number().int().positive(),
    deposited: z.string(),
    claimed: z.string(),
    claimable: z.string(),
    vested: z.string(),
    unclaimed: z.string(),
    lastDepositTimestamp: z.string().datetime({ offset: true }),
    decayRatePerMillion: z.number().int().nonnegative(),
});

export type Evaluation = z.infer<typeof zStream>;

export const getStream = async (nftId: number) => {
    const stream = await graphql(
        `
            {
                stream(nftId: ${nftId}) {
                    nftId
                    tokenId
                    deposited
                    claimed
                    claimable
                    unclaimed
                    vested
                    lastDepositTimestamp
                    decayRatePerMillion
                }
            }
        `,
        siblingUrl(null, "token-stream", "/graphql"),
    );

    const response = z
        .object({
            stream: zStream,
        })
        .parse(stream);

    return response.stream;
};
