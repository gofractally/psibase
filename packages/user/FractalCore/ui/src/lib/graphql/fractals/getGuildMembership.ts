import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";
import { zDateTime } from "@/lib/zod/DateTime";

import { Account } from "@shared/lib/schemas/account";

import { graphql } from "../../graphql";

const FractalSchema = z.object({
    account: z.string(),
});

const GuildSchema = z.object({
    account: z.string(),
    displayName: z.string(),
    candidacyCooldown: z.number().int(),
    fractal: FractalSchema,
});

const NodeSchema = z
    .object({
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
                isCandidate
                score
                candidacyEligibleFrom
                    guild {
                        account
                        displayName
                        candidacyCooldown
                        fractal {
                            account
                        }
                    }

            }
        }
    `,
        FRACTALS_SERVICE,
    );

    console.log("raw", res);
    return DataSchema.parse(res).guildMembership;
};
