import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "./graphql";
import { zAccount } from "./types/account";

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

export const zEvent = z.object({
    amount: z.number().int(),
    action: z.enum(["Deposit", "Claim"]),
    actor: zAccount,
});

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
                updates(nftId: ${nftId}) {
                    nodes {
                    nftId
                    actor
                    amount
                    txType
                    }
                }
            }
        `,
        siblingUrl(null, "token-stream", "/graphql"),
    );

    const response = z
        .object({
            stream: zStream,
            updates: z.object({
                nodes: z
                    .object({
                        nftId: z.number(),
                        actor: zAccount,
                        amount: z.number().int(),
                        txType: z.enum(["deposited", "claimed"]),
                    })
                    .array(),
            }),
        })
        .parse(stream);

    return {
        stream: response.stream,
        updates: response.updates.nodes.reverse(),
    };
};
