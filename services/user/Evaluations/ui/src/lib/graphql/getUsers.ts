import { z } from "zod";
import { graphql } from "../graphql";
import { zAccount } from "../zod/Account";

export const zUser = z.object({
    user: zAccount,
    groupNumber: z.number().nullable(),
    proposal: z.number().array().nullable(),
    attestation: z.number().array().nullable(),
});

export type User = z.infer<typeof zUser>;

export const getUsers = async (evaluationId: number) => {
    const res = await graphql(
        `{ getUsers(id: ${evaluationId}) { user groupNumber evaluationId proposal attestation } }`,
        "evaluations",
    );

    const response = z
        .object({
            data: z.object({
                getUsers: zUser.array(),
            }),
        })
        .parse(res);

    return response.data.getUsers;
};
