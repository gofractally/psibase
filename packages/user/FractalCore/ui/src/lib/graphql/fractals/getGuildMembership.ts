import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import { Account, zAccount } from "@/lib/zod/Account";

import { graphql } from "../../graphql";

export const zGuildList = z.object({
    slug: zAccount,
    id: z.number().int(),
    displayName: z.string(),
});

export type Membership = z.infer<typeof zGuildList>;

export const getGuildMemberships = async (
    fractal: Account,
    member: Account,
) => {
    const res = await graphql(
        `
        {
            guildMemberships(fractal: "${fractal}", member: "${member}") {
                nodes {
                    guild {
                        id
                        slug
                        displayName
                    }
                }
            }
        }
    `,
        fractalsService,
    );

    return z
        .object({
            guildMemberships: z.object({
                nodes: z
                    .object({
                        guild: zGuildList,
                    })
                    .array(),
            }),
        })
        .parse(res).guildMemberships.nodes;
};
