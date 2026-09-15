import z from "zod";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
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
    const response = await graphqlAuth(
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
