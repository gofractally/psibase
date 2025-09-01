import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "./graphql";

export const zStream = z.object({
    nftId: z.number().int().positive(),
    tokenId: z.number().int().positive(),
    deposited: z.string(),
    claimed: z.string(),
    unclaimed: z.string(),
    vested: z.string(),
});

export type Evaluation = z.infer<typeof zStream>;

export const getStreams = async () => {
    const streams = await graphql(
        `
            {
                streams {
                    nodes {
                        nftId
                        tokenId
                        deposited
                        claimed
                        unclaimed
                        vested
                    }
                }
            }
        `,
        siblingUrl(null, "token-stream", "/graphql"),
    );

    console.log("x");
    const response = z
        .object({
            streams: z.object({
                nodes: zStream.array(),
            }),
        })
        .parse(streams);

    return response.streams.nodes;
};
