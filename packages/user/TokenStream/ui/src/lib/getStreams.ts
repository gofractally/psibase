import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "./graphql";

export const zStream = z.object({
    nftId: z.number().int().positive(),
    tokenId: z.number().int().positive(),
    deposited: z.string(),
    claimable: z.string(),
    unclaimed: z.string(),
    vested: z.string(),
});

export const getStreams = async () => {
    const streams = await graphql(
        `
            {
                streams {
                    nodes {
                        nftId
                        tokenId
                        deposited
                        claimable
                        unclaimed
                        vested
                    }
                }
            }
        `,
        siblingUrl(null, "token-stream", "/graphql"),
    );

    const response = z
        .object({
            streams: z.object({
                nodes: zStream.array(),
            }),
        })
        .parse(streams);

    return response.streams.nodes;
};
