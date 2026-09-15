import { z } from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
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
    const member = await callGraphqlViaPlugin(
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
