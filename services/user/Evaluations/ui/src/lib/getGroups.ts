import { Group } from "@radix-ui/react-dropdown-menu";
import { z } from "zod";
import { graphql } from "./graphql";


export const zGroup = z.object({
    evaluationId: z.number(),
    number: z.number(),
    keySubmitter: z.string(),
    keyHash: z.string(),
    keys: z.array(z.string()),
    result: z.string(),
})

export type Group = z.infer<typeof zGroup>

export const getGroups = async (evaluationId: number) => {

    const res = await graphql(`{ getGroups(id: ${evaluationId}) { evaluationId, number, keySubmitter, keyHash, keys, result } }`, "evaluations")

    const response = z.object({
        data: z.object({
            getGroups: z.array(zGroup)
        })
    }).parse(res)

    return response.data.getGroups;
};
