import { z } from "zod";

import { graphql } from "@/lib/graphql";
import { zAccount } from "@/lib/zod/Account";

export const zGroupFinishes = z.object({
    groupNumber: z.number(),
    users: z.array(zAccount),
    result: z.array(zAccount),
});

export type EvaluationResults = z.infer<typeof zGroupFinishes>;

export const getEvaluationResults = async (evaluationId: number) => {
    const gql = `{
        groupFinishes(evaluationId: ${evaluationId}) {
            nodes {
                groupNumber
                users
                result
            }
        }
    }`;

    const results = await graphql(gql);

    const response = z
        .object({
            groupFinishes: z.object({
                nodes: z.array(zGroupFinishes),
            }),
        })
        .parse(results);

    return response.groupFinishes.nodes;
};
