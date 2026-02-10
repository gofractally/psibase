import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";
import { zDateTime } from "@/lib/zod/DateTime";

import { graphql } from "@shared/lib/graphql";
import { Account, zAccount } from "@shared/lib/schemas/account";

export const zScore = z.object({
    member: zAccount,
    score: z.number(),
    createdAt: zDateTime,
});

export type Score = z.infer<typeof zScore>;

export const getScores = async (guild: Account) => {
    const member = await graphql(
        `
    {
        scores(guild: "${guild}") {
            nodes {
                member
                score
                createdAt
            } 
        }
    }`,
        { service: FRACTALS_SERVICE },
    );

    return z
        .object({
            scores: z.object({
                nodes: zScore.array(),
            }),
        })
        .parse(member).scores.nodes;
};
