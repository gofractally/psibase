import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";

import { graphql } from "@shared/lib/graphql";
import { Account, zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

const FractalSchema = z.object({
    account: zAccount,
});

const RepSchema = z.object({
    member: zAccount,
});

const GuildSchema = z.object({
    account: zAccount,
    displayName: z.string(),
    candidacyCooldown: z.number().int(),
    council: zAccount.array().nullable(),
    fractal: FractalSchema,
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
    const res = await graphql(
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
                    fractal {
                        account
                    }
                    rep {
                        member
                    }
                }

            }
        }
    `,
        { service: FRACTALS_SERVICE },
    );

    return DataSchema.parse(res).guildMembership;
};
