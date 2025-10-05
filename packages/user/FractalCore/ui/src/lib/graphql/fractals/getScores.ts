import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import { zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";

import { graphql } from "../../graphql";

export const zScore = z.object({
    fractal: zAccount,
    member: zAccount,
    score: z.number(),
    pendingScore: z.number().nullable(),
    createdAt: zDateTime,
});

export type Score = z.infer<typeof zScore>;

export const getScores = async (guildId: number) => {
    const member = await graphql(
        `
    {
        scores(guildId: ${guildId}) {
            nodes {
                fractal
                member
                score
                pendingScore
                createdAt
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
