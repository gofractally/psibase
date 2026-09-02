import { z } from "zod";

import { GUILDS_SERVICE } from "@shared/domains/fractal/lib/constants";
import { graphql } from "@shared/lib/graphql";
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
    const res = await graphql(
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
        { service: GUILDS_SERVICE },
    );

    return DataSchema.parse(res).guildsByFractal.nodes;
};
