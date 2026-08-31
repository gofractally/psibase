import { z } from "zod";

import { zUnix } from "@shared/lib/schemas/unix";

import { GUILDS_SERVICE } from "@shared/domains/fractal/lib/constants";
import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import { evaluation as evaluationPlugin } from "@shared/lib/plugins";
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
    const evaluation = await authorizedPluginGraphql(
        evaluationPlugin.authorized.graphql,
        `
    {
        getEvaluation(owner: "${GUILDS_SERVICE}", evaluationId: ${id}) {     
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
