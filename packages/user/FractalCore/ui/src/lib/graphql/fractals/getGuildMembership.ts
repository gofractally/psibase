import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";

import { Account } from "@shared/lib/schemas/account";

import { graphql } from "../../graphql";

const FractalSchema = z.object({
    account: z.string(),
});

const GuildSchema = z.object({
    account: z.string(),
    displayName: z.string(),
    fractal: FractalSchema,
});

const NodeSchema = z.object({
    guild: GuildSchema,
});

const GuildMembershipsSchema = z.object({
    nodes: z.array(NodeSchema),
});

const DataSchema = z.object({
    guildMemberships: GuildMembershipsSchema,
});

export const getGuildMemberships = async (member: Account) => {
    const res = await graphql(
        `
        {
            guildMemberships(member:"${member}") {
                nodes {
                    guild {
                        account
                        displayName
                        fractal {
                            account
                        }
                    }
                }
            }
        }
    `,
        FRACTALS_SERVICE,
    );

    return DataSchema.parse(res).guildMemberships.nodes;
};
