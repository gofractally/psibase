import { Group } from "@radix-ui/react-dropdown-menu";
import { z } from "zod";
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
    evaluationId: z.number(),
    number: z.number(),
    keySubmitter: z.string().nullable(),
    result: z.number().array().nullable(),
});

const SuccessResponse = z.object({
    data: z.object({
        getGroups: z.array(zGroup),
    }),
});

const GraphqlResponse = ErrorResponse.or(SuccessResponse);

export type Group = z.infer<typeof zGroup>;

export const getGroups = async (evaluationId: number): Promise<Group[]> => {
    const res = await graphql(
        `{ getGroups(id: ${evaluationId}) { evaluationId, number, keySubmitter, result } }`,
        "evaluations",
    );

    const response = GraphqlResponse.parse(res);

    if (response.data) {
        return response.data.getGroups;
    }
    throw new Error(response.errors[0].message);
};
