import { z } from "zod";

import { graphql } from "@shared/lib/graphql";

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
        { service: "token-stream" },
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
