import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@/lib/graphql";
import { Account, zAccount } from "@/lib/zod/Account";

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

export const zUsersAndGroupsResponse = z.object({
    users: zUser.array(),
    groups: zGroup.array(),
    results: zResult.array(),
});

export type GroupResult = z.infer<typeof zResult>;
export type UsersAndGroups = z.infer<typeof zUsersAndGroupsResponse>;

export const getUsersAndGroups = async (
    owner: Account,
    evaluationId: number,
): Promise<UsersAndGroups> => {
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
        siblingUrl(null, "evaluations", "/graphql"),
    );

    console.log(res, "was the res");

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

    console.log({ response });

    return zUsersAndGroupsResponse.parse({
        users: response.getUsers.nodes,
        groups: response.getGroups.nodes,
        results: response.getGroupResult.nodes,
    });
};
