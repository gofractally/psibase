import { z } from "zod";

import { evaluationsService, fractalsService } from "@/lib/constants";
import { graphql } from "@/lib/graphql";
import { zAccount } from "@/lib/zod/Account";
import { zUnix } from "@/lib/zod/Unix";

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
        getEvaluation(owner: "${fractalsService}", evaluationId: ${id}) {     
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
        evaluationsService,
    );

    const response = z
        .object({
            getEvaluation: zEvaluation,
        })
        .parse(evaluation);

    return response.getEvaluation;
};
