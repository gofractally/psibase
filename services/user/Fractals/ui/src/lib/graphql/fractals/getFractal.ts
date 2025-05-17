import { z } from "zod";

import { Account, zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";
import { zEvalType } from "@/lib/zod/EvaluationType";

import { graphql } from "../../graphql";

export const zFractal = z
    .object({
        account: zAccount,
        createdAt: zDateTime,
        name: z.string(),
        mission: z.string(),
        rewardWaitPeriod: z.number().or(z.null()),
    })
    .or(z.null());

export const zEvaluation = z
    .object({
        fractal: zAccount,
        evalType: zEvalType,
        interval: z.number(),
        evaluationId: z.number(),
    })
    .array();

const FractalRes = z.object({
    fractal: zFractal,
    evaluations: zEvaluation,
});

export type FractalRes = z.infer<typeof FractalRes>;

export const getFractal = async (owner: Account) => {
    const fractal = await graphql(
        `
    {
        fractal(fractal: "${owner}") {     
            account
            createdAt
            name
            mission
            rewardWaitPeriod
        }
        evaluations(fractal: "${owner}") {
            fractal
            evalType
            interval
            evaluationId
        }
    }`,
    );

    return FractalRes.parse(fractal);
};
