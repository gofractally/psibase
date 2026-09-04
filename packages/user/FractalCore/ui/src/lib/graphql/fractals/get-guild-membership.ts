import { z } from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { guilds } from "@shared/lib/plugins";
import { Account, zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";


const RepSchema = z.object({
    member: zAccount,
});

const GuildSchema = z.object({
    account: zAccount,
    displayName: z.string(),
    candidacyCooldown: z.number().int(),
    council: zAccount.array().nullable(),
    rep: RepSchema,
});

const NodeSchema = z
    .object({
        createdAt: zDateTime,
        guild: GuildSchema,
        score: z.number(),
        candidacyEligibleFrom: zDateTime,
        isCandidate: z.boolean(),
    })
    .nullable();

const DataSchema = z.object({
    guildMembership: NodeSchema,
});

export const getGuildMembership = async (guild: Account, member: Account) => {
    const res = await callGraphqlViaPlugin(
        guilds.authorized.graphql,
        `
        {
            guildMembership(guild:"${guild}", member:"${member}") {
                createdAt
                isCandidate
                score
                candidacyEligibleFrom
                guild {
                    account
                    displayName
                    candidacyCooldown
                    council
                    rep {
                        member
                    }
                }

            }
        }
    `,
    );

    return DataSchema.parse(res).guildMembership;
};
