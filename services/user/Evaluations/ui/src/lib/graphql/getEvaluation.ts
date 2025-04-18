import { z } from "zod";
import { graphql } from "./graphql";
import { zAccount, Account } from "./zod/Account";
import { zUnix } from "./zod/unix";

export const zEvaluation = z.object({
    id: z.number(),
    createdAt: zUnix,
    owner: zAccount,
    registrationStarts: zUnix,
    deliberationStarts: zUnix,
    submissionStarts: zUnix,
    finishBy: zUnix,
    allowableGroupSizes: z.number().array(),
    useHooks: z.boolean(),
    rankAmount: z.number(),
});

export type Evaluation = z.infer<typeof zEvaluation>;

export const getEvaluation = async (owner: Account, id: number) => {
    const evaluation = await graphql(
        `
    {
        getEvaluation(owner: ${owner}, evaluationId: ${id}) {     
            id,
            createdAt,
            owner,
            registrationStarts,
            deliberationStarts,
            submissionStarts,
            finishBy,
            allowableGroupSizes,
            useHooks,
            rankAmount
        } 
    }`,
        "evaluations",
    );

    const response = z
        .object({
            data: z.object({
                getEvaluation: zEvaluation,
            }),
        })
        .parse(evaluation);

    return response.data.getEvaluation;
};
