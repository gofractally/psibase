import { z } from "zod";

import { Account } from "@/lib/zod/Account";

import { graphql } from "../graphql";

const ErrorResponse = z.object({
    errors: z.array(
        z.object({
            message: z.string(),
            locations: z.array(
                z.object({
                    line: z.number(),
                    column: z.number(),
                }),
            ),
        }),
    ),
    data: z.null(),
});

export const zGroup = z.object({
    owner: z.string(),
    number: z.number(),
    evaluationId: z.number(),
    keySubmitter: z.string().nullable(),
});

const SuccessResponse = z.object({
    data: z.object({
        getGroups: z.object({
            nodes: z.array(zGroup),
        }),
    }),
});

const GraphqlResponse = ErrorResponse.or(SuccessResponse);

export type Group = z.infer<typeof zGroup>;

export const getGroups = async (
    owner: Account,
    evaluationId: number,
): Promise<Group[]> => {
    const res = await graphql(
        `{ getGroups(owner: "${owner}", evaluationId: ${evaluationId}) { nodes { owner number evaluationId keySubmitter result } } }`,
        "evaluations",
    );

    const response = GraphqlResponse.parse(res);

    if (response.data) {
        return response.data.getGroups.nodes;
    }
    throw new Error(response.errors[0].message);
};
