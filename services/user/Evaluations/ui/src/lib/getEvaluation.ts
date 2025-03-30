import { z } from "zod"
import { graphql } from "./graphql"
import { Account } from "./zod/Account";
import { zUnix } from "./zod/unix";


export const zEvaluation = z.object({
    id: z.number(),
    createdAt: zUnix,
    owner: Account,
    registrationStarts: zUnix,
    deliberationStarts: zUnix,
    submissionStarts: zUnix,
    finishBy: zUnix,
    allowableGroupSizes: z.number().array(),
    useHooks: z.boolean(),
})


export type Evaluation = z.infer<typeof zEvaluation>;

export const getEvaluation = async (id: number) => {
    const evaluation = await graphql(`{ getEvaluation(id: ${id}) {     id
  	createdAt,
    owner,
    registrationStarts,
    deliberationStarts,
    submissionStarts,
    finishBy,
    allowableGroupSizes,
    useHooks
         } }`, "evaluations")

    const response = z.object({
        data: z.object({
            getEvaluation: zEvaluation
        })
    }).parse(evaluation)

    return response.data.getEvaluation;
}