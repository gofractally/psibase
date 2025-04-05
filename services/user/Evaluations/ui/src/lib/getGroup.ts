import { Group } from "@radix-ui/react-dropdown-menu";
import { z } from "zod";
import { graphql } from "./graphql";
import { zAccount } from "./zod/Account";

export const zGroup = z.object({
    evaluationId: z.number(),
    number: z.number(),
    keySubmitter: z.string().nullable(),
    keyHash: z.string().nullable(),
    keys: z.array(z.number().array()),
    result: z.string().nullable(),
});

export const zGroupUser = z.object({
    key: z.string(),
    user: zAccount,
    proposal: zAccount.array().nullable(),
});

export type Group = z.infer<typeof zGroup>;

export const getGroup = async (evaluationId: number, groupNumber: number) => {
    const res = await graphql(
        `{ getGroup(id: ${evaluationId}, groupNumber: ${groupNumber}) { evaluationId, number, keySubmitter, keyHash, keys, result } 
              getGroupUsers(id: ${evaluationId}, groupNumber: ${groupNumber}) {
                key
                user
                proposal
              }
        }`,
        "evaluations",
    );

    const response = z
        .object({
            data: z.object({
                getGroup: zGroup.nullable(),
                getGroupUsers: zGroupUser.array(),
            }),
        })
        .parse(res);

    return {
        group: response.data.getGroup,
        users: response.data.getGroupUsers,
    };
};
