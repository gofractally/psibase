import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import { Account, zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";

import { graphql } from "../../graphql";

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
