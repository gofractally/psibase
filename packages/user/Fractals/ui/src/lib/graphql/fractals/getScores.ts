import { z } from "zod";

import { Account, zAccount } from "@/lib/zod/Account";
import { zEvalType } from "@/lib/zod/EvaluationType";

import { graphql } from "../../graphql";

export const zScore = z.object({
    account: zAccount,
    evalType: zEvalType,
    pending: z.number().nullable(),
    value: z.number(),
});

export type Score = z.infer<typeof zScore>;

export const getScores = async (fractalAccount: Account) => {
    const member = await graphql(
        `
    {
        scores(fractal: "${fractalAccount}") {
            nodes {
                account
                evalType
                pending
                value
        } }
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
