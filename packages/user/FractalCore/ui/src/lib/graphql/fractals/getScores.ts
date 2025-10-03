import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import { zAccount } from "@/lib/zod/Account";

import { graphql } from "../../graphql";

export const zScore = z.object({
    fractal: zAccount,
    guild: z.number().int(),
    member: zAccount,
    score: z.number(),
    pendingScore: z.number().nullable(),
});

export type Score = z.infer<typeof zScore>;

export const getScores = async (guildId: number) => {
    const member = await graphql(
        `
    {
        scores(guildId: ${guildId}) {
            nodes {
                fractal
                guild
                member
                score
                pendingScore
            } 
        }
    }`,
        fractalsService,
    );

    return z
        .object({
            scores: z.object({
                nodes: zScore.array(),
            }),
        })
        .parse(member).scores.nodes;
};
