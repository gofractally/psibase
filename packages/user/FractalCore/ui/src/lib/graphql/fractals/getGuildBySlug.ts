import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import { Account, zAccount } from "@/lib/zod/Account";

import { graphql } from "../../graphql";

export const zGuild = z.object({
    id: z.number().int(),
    displayName: z.string(),
    council: zAccount.array(),
    rep: z.object({ member: zAccount }).nullable(),
    evalInstance: z
        .object({
            evaluationId: z.number().int(),
            interval: z.number().int(),
        })
        .nullable(),
    bio: z.string(),
});

export const getGuildBySlug = async (guildAccount: Account) => {
    const res = await graphql(
        `
        {
            guild(guild:"${guildAccount}") {
                id
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
            }
        }
    `,
        fractalsService,
    );

    return z
        .object({
            guild: zGuild.nullable(),
        })
        .parse(res).guild;
};
