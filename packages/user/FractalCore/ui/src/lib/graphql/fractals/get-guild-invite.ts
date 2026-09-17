import z from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { guilds } from "@shared/lib/plugins";
import { zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

const zGuildInviteDetailsResponse = z.object({
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
});

export const getGuildInvite = async (inviteId: number) => {
    const response = await callGraphqlViaPlugin(
        guilds.authorized.graphql,
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
    return zGuildInviteDetailsResponse.parse(response).guildInvite;
};
