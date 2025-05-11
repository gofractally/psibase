import { z } from "zod";

import { Account, zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";

import { graphql } from "../../graphql";

export const zFractal = z
    .object({
        account: zAccount,
        createdAt: zDateTime,
        name: z.string(),
        mission: z.string(),
        scheduledEvaluation: z.number().or(z.null()),
        evaluationInterval: z.number().or(z.null()),
        rewardWaitPeriod: z.number().or(z.null()),
    })
    .or(z.null());

export type Fractal = z.infer<typeof zFractal>;

export const getFractal = async (owner: Account) => {
    const fractal = await graphql(
        `
    {
        fractal(fractal: "${owner}") {     
            account
            createdAt
            name
            mission
            scheduledEvaluation
            evaluationInterval
            rewardWaitPeriod
        } 
    }`,
    );

    return z
        .object({
            fractal: zFractal,
        })
        .parse(fractal).fractal;
};
