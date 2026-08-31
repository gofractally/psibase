import { z } from "zod";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import { evaluation as evaluationPlugin } from "@shared/lib/plugins";
import { type Account, zAccount } from "@shared/lib/schemas/account";
import { zUnix } from "@shared/lib/schemas/unix";

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

export const getEvaluation = async (owner: Account, id: number) => {
    const evaluation = await authorizedPluginGraphql(
        evaluationPlugin.authorized.graphql,
        `
    {
        getEvaluation(owner: "${owner}", evaluationId: ${id}) {     
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
    );

    const response = z
        .object({
            getEvaluation: zEvaluation,
        })
        .parse(evaluation);

    return response.getEvaluation;
};
