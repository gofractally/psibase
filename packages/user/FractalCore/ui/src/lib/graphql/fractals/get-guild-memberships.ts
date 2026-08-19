import { z } from "zod";

import { GUILDS_SERVICE } from "@shared/domains/fractal/lib/constants";
import { graphql } from "@shared/lib/graphql";
import { Account } from "@shared/lib/schemas/account";

const GuildSchema = z.object({
    account: z.string(),
    displayName: z.string(),
    fractal: z.string(),
});

const NodeSchema = z.object({
    guild: GuildSchema,
});

const GuildMembershipsSchema = z.object({
    nodes: z.array(NodeSchema),
});

const DataSchema = z.object({
    memberships: GuildMembershipsSchema,
});

export const getGuildMemberships = async (member: Account) => {
    const res = await graphql(
        `
        {
            memberships(member:"${member}") {
                nodes {
                    guild {
                        account
                        displayName
                        fractal
                    }
                }
            }
        }
    `,
        { service: GUILDS_SERVICE },
    );

    return DataSchema.parse(res).memberships.nodes;
};
