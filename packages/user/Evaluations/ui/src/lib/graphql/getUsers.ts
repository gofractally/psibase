import { z } from "zod";

import { graphql } from "@shared/lib/graphql";
import { type Account, zAccount } from "@shared/lib/schemas/account";

export const zUser = z.object({
    user: zAccount,
    groupNumber: z.number().nullable(),
    proposal: z.number().array().nullable(),
    attestation: z.number().array().nullable(),
    evaluationId: z.number(),
});

export const zGroup = z.object({
    owner: z.string(),
    number: z.number(),
    evaluationId: z.number(),
    keySubmitter: z.string().nullable(),
});

export const zResult = z.object({
    groupNumber: z.number(),
    result: z.number().array(),
    users: zAccount.array(),
});

export type User = z.infer<typeof zUser>;

export const FunctionResponse = z.object({
    users: zUser.array(),
    groups: zGroup.array(),
    results: zResult.array(),
});

export const getUsersAndGroups = async (
    owner: Account,
    evaluationId: number,
) => {
    const res = await graphql(
        `{ 
            getUsers(owner: "${owner}", evaluationId: ${evaluationId}) {
                nodes { 
                    user
                    groupNumber 
                    evaluationId
                    proposal 
                    attestation 
                }
            }
            getGroups(owner: "${owner}", evaluationId: ${evaluationId}) { 
                nodes { 
                    owner 
                    number 
                    evaluationId 
                    keySubmitter 
                } 
            }
        	getGroupResult(evaluationOwner: "${owner}", evaluationId: ${evaluationId}) {
                nodes {
                    groupNumber
                    result
                    users
                }
            }
        }`,
        { service: "evaluations" },
    );

    const response = z
        .object({
            getUsers: z.object({
                nodes: zUser.array(),
            }),
            getGroups: z.object({
                nodes: zGroup.array(),
            }),
            getGroupResult: z.object({
                nodes: zResult.array(),
            }),
        })
        .parse(res);

    return FunctionResponse.parse({
        users: response.getUsers.nodes,
        groups: response.getGroups.nodes,
        results: response.getGroupResult.nodes,
    });
};
