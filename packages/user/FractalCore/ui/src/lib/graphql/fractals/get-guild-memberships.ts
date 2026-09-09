import { z } from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { guilds } from "@shared/lib/plugins";
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
    const res = await callGraphqlViaPlugin(
        guilds.authorized.graphql,
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
    );

    return DataSchema.parse(res).memberships.nodes;
};
