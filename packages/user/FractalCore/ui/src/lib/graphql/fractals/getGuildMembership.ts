import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import { Account } from "@/lib/zod/Account";

import { derp } from "../../graphql";

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
    const res = await derp(
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
        fractalsService,
    );

    return DataSchema.parse(res).guildMemberships.nodes;
};
