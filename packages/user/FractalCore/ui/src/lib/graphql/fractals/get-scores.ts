import { z } from "zod";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { guilds } from "@shared/lib/plugins";
import { Account, zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

export const zScore = z.object({
    member: zAccount,
    score: z.number(),
    createdAt: zDateTime,
});

export type Score = z.infer<typeof zScore>;

export const getScores = async (guild: Account) => {
    const member = await graphqlAuth(
        guilds.authorized.graphql,
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
    );

    return z
        .object({
            scores: z.object({
                nodes: zScore.array(),
            }),
        })
        .parse(member).scores.nodes;
};
