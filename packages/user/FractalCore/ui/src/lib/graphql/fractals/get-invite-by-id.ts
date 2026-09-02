import z from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { invite } from "@shared/lib/plugins";
import { zDateTime } from "@shared/lib/schemas/date-time";

const zInviteDetailsResponse = z.object({
    inviteById: z
        .object({
            inviter: z.string(),
            numAccounts: z.number(),
            expiryDate: zDateTime.transform((date) => new Date(date)),
        })
        .nullable(),
});

export const getInviteById = async (inviteId: number) => {
    const response = await callGraphqlViaPlugin(
        invite.authorized.graphql,
        `
            query InviteById {
                inviteById(inviteId: ${inviteId}) {
                    inviter
                    numAccounts
                    expiryDate
                }
            }
        `,
    );
    return zInviteDetailsResponse.parse(response).inviteById;
};
