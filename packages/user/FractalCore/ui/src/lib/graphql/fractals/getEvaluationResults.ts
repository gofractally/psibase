import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import { derp } from "@/lib/graphql";
import { zAccount } from "@/lib/zod/Account";

export const zGroupFinishes = z.object({
    groupNumber: z.number(),
    users: z.array(zAccount),
    result: z.array(zAccount),
});

export const zGroupsCreated = z.object({
    groupNumber: z.number(),
    users: z.array(zAccount),
});

export type EvaluationResults = z.infer<typeof zGroupFinishes>;

export const getEvaluationResults = async (evaluationId: number) => {
    const gql = `{
        getGroupsCreated(evaluationId: ${evaluationId}) {
            nodes {
                groupNumber
                users
            }
        }
        groupFinishes(evaluationId: ${evaluationId}) {
            nodes {
                groupNumber
                users
                result
            }
        }
    }`;

    const results = await derp(gql, fractalsService);

    const response = z
        .object({
            getGroupsCreated: z.object({
                nodes: z.array(zGroupsCreated),
            }),
            groupFinishes: z.object({
                nodes: z.array(zGroupFinishes),
            }),
        })
        .parse(results);

    return response.getGroupsCreated.nodes
        .map((group) => ({
            ...group,
            result: response.groupFinishes.nodes.find(
                (group) => group.groupNumber === group.groupNumber,
            )?.result,
        }))
        .sort((a, b) => a.groupNumber - b.groupNumber);
};
