import { z } from "zod";

import { GUILDS_SERVICE } from "@shared/domains/fractal/lib/constants";
import { graphql } from "@shared/lib/graphql";
import { Account, zAccount } from "@shared/lib/schemas/account";

export const zGuild = z.object({
    account: zAccount,
    owner: zAccount,
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
    const res = await graphql(
        `
        {
            guild(account:"${guildAccount}") {
                account
                owner
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
        { service: GUILDS_SERVICE },
    );

    return z
        .object({
            guild: zGuild.nullable(),
        })
        .parse(res).guild;
};
