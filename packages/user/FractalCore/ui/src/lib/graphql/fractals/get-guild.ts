import { z } from "zod";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import { guilds } from "@shared/lib/plugins";
import { Account, zAccount } from "@shared/lib/schemas/account";

export const zGuild = z.object({
    account: zAccount,
    fractal: zAccount,
    displayName: z.string(),
    council: zAccount.array().nullable(),
    rep: z.object({ member: zAccount }).nullable(),
    evalInstance: z
        .object({
            evaluationId: z.number().int(),
            interval: z.number().int(),
        })
        .nullable(),
    bio: z.string(),
    description: z.string(),
});

export type Guild = z.infer<typeof zGuild>;

export const getGuild = async (guildAccount: Account) => {
    const res = await authorizedPluginGraphql(
        guilds.authorized.graphql,
        `
        {
            guild(account:"${guildAccount}") {
                account
                fractal
                displayName
                rep {
                    member
                }
                evalInstance {
                    evaluationId
                    interval
                }
                council
                bio
                description
            }
        }
    `,
    );

    return z
        .object({
            guild: zGuild.nullable(),
        })
        .parse(res).guild;
};
