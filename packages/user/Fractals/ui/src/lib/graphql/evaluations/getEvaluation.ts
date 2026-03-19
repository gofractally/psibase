import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@/lib/graphql";
import { zUnix } from "@/lib/zod/Unix";

import { FRACTALS_SERVICE } from "@shared/domains/fractal/lib/constants";
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
        siblingUrl(null, "evaluations", "/graphql"),
    );

    const response = z
        .object({
            getEvaluation: zEvaluation,
        })
        .parse(evaluation);

    return response.getEvaluation;
};
