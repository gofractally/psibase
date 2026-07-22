import z from "zod";

import { postGraphQLGetJson, siblingUrl } from "@psibase/common-lib";

import { zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

const zGuildInviteDetailsResponse = z.object({
    data: z.object({
        guildInvite: z
            .object({
                createdAt: zDateTime,
                inviter: zAccount,
                guild: z.object({
                    account: zAccount,
                    bio: z.string(),
                    displayName: z.string(),
                }),
            })
            .nullable(),
    }),
});

export const getGuildInvite = async (inviteId: number) => {
    const response = await postGraphQLGetJson(
        siblingUrl(undefined, "guilds", "graphql"),
        `
        {
            guildInvite(id: ${inviteId}) {
                createdAt
                guild {
                    account
                    bio
                    displayName
                }
                inviter
            }
        }
        `,
    );
    return zGuildInviteDetailsResponse.parse(response).data.guildInvite;
};
