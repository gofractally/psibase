import { z } from "zod";

import { Account, zAccount } from "@/lib/zod/Account";

import { graphql } from "../../graphql";

export const zGuild = z.object({
    id: z.number().int(),
    displayName: z.string(),
    rep: zAccount.nullable(),
    bio: z.string(),
});

export const getGuildBySlug = async (fractal: Account, slug: Account) => {
    const res = await graphql(`
        {
            guildBySlug(fractal:"${fractal}", slug:"${slug}}") {
                id
                displayName
                rep
                bio
            }
        }
    `);

    return z
        .object({
            guildBySlug: zGuild.nullable(),
        })
        .parse(res).guildBySlug;
};
