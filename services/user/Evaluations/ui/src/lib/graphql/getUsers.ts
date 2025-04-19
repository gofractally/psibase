import { z } from "zod";
import { graphql } from "../graphql";
import { Account, zAccount } from "../zod/Account";

export const zUser = z.object({
    user: zAccount,
    groupNumber: z.number().nullable(),
    proposal: z.number().array().nullable(),
    attestation: z.number().array().nullable(),
    evaluationId: z.number(),
});

export type User = z.infer<typeof zUser>;

export const getUsers = async (owner: Account, evaluationId: number) => {
    console.log("getUsers", owner, evaluationId);
    const res = await graphql(
        `{ 
            getUsers(owner: "${owner}", evaluationId: ${evaluationId}) {
                nodes { 
                    user
                    groupNumber 
                    evaluationId
                    proposal 
                    attestation 
                }} 
        }`,
        "evaluations",
    );
    console.log("res", res);

    const response = z
        .object({
            data: z.object({
                getUsers: z.object({
                    nodes: zUser.array(),
                }),
            }),
        })
        .parse(res);

    return response.data.getUsers.nodes;
};
