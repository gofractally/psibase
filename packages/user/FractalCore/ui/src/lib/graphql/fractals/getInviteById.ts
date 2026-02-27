import { zDateTime } from "@/lib/zod/DateTime";
import { postGraphQLGetJson, siblingUrl } from "@psibase/common-lib";
import z from "zod";


const zInviteDetailsResponse = z.object({
    data: z.object({
        inviteById: z.object({
            inviter: z.string(),
            numAccounts: z.number(),
            expiryDate: zDateTime.transform(date => new Date(date)),
        }).nullable(),
    }),
});

export const getInviteById = async (inviteId: number) => {

    const response = await postGraphQLGetJson(
        siblingUrl(undefined, "invite", "graphql", true),
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
    return zInviteDetailsResponse.parse(response).data.inviteById;
}
