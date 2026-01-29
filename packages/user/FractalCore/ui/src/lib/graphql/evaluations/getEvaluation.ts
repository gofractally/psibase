import { z } from "zod";

import { EVALUATIONS_SERVICE, FRACTALS_SERVICE } from "@/lib/constants";
import { graphql } from "@/lib/graphql";
import { zUnix } from "@/lib/zod/Unix";

import { zAccount } from "@shared/lib/schemas/account";

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
    numOptions: z.number(),
});

export type Evaluation = z.infer<typeof zEvaluation>;

export const getEvaluation = async (id: number) => {
    const evaluation = await graphql(
        `
    {
        getEvaluation(owner: "${FRACTALS_SERVICE}", evaluationId: ${id}) {     
            id,
            createdAt,
            owner,
            registrationStarts,
            deliberationStarts,
            submissionStarts,
            finishBy,
            allowableGroupSizes,
            useHooks,
            numOptions
        } 
    }`,
        EVALUATIONS_SERVICE,
    );

    const response = z
        .object({
            getEvaluation: zEvaluation,
        })
        .parse(evaluation);

    return response.getEvaluation;
};
