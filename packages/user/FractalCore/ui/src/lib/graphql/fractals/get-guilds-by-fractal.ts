import { z } from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { guilds } from "@shared/lib/plugins";
import { Account } from "@shared/lib/schemas/account";


const NodeSchema = z.object({
    account: z.string(),
    description: z.string(),
    displayName: z.string(),
    rep: z.object({
        member: z.string()
    })
});

const GuildMembershipsSchema = z.object({
    nodes: z.array(NodeSchema),
});

const DataSchema = z.object({
    guildsByFractal: GuildMembershipsSchema,
});

export const getGuildsByFractal = async (member: Account) => {
    const res = await callGraphqlViaPlugin(
        guilds.authorized.graphql,
        `
            {
            guildsByFractal(fractal:"${member}") {
                nodes {
                account
                description
                displayName
                rep {
                    member
                }
                }
            }

            }
    `,
    );

    return DataSchema.parse(res).guildsByFractal.nodes;
};
