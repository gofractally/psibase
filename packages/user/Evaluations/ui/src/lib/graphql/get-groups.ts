import { z } from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { evaluation } from "@shared/lib/plugins";
import { Account } from "@shared/lib/schemas/account";

export const zGroup = z.object({
    owner: z.string(),
    number: z.number(),
    evaluationId: z.number(),
    keySubmitter: z.string().nullable(),
});

const SuccessResponse = z.object({
    getGroups: z.object({
        nodes: z.array(zGroup),
    }),
});

export type Group = z.infer<typeof zGroup>;

export const getGroups = async (
    owner: Account,
    evaluationId: number,
): Promise<Group[]> => {
    const res = await callGraphqlViaPlugin(
        evaluation.authorized.graphql,
        `{ getGroups(owner: "${owner}", evaluationId: ${evaluationId}) { nodes { owner number evaluationId keySubmitter result } } }`,
    );

    return SuccessResponse.parse(res).getGroups.nodes;
};
