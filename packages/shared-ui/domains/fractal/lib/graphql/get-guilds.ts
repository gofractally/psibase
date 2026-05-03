import { z } from "zod";

import { GUILDS_SERVICE } from "../constants";

import { graphql } from "@shared/lib/graphql";
import { Account, zAccount } from "@shared/lib/schemas/account";

export const zGuildsRes = z.object({
    guilds: z.object({
        nodes: z
            .object({
                account: zAccount,
                rep: z
                    .object({
                        member: zAccount,
                    })
                    .optional(),
                displayName: z.string(),
                council: z.array(zAccount).nullable(),
                bio: z.string(),
                evalInstance: z
                    .object({
                        evaluationId: z.number().int(),
                    })
                    .nullable(),
            })
            .array(),
    }),
});

export type GuildsRes = z.infer<typeof zGuildsRes>;

export const getGuilds = async (fractal: Account): Promise<GuildsRes> => {
    const guilds = await graphql(
        `
    {
        guilds(fractal: "${fractal}") {
            nodes {
                account
                rep {
                    member
                }
                displayName
                council
                bio
                evalInstance {
                  evaluationId
                }
            }
        }
    }`,
        { service: GUILDS_SERVICE },
    );

    return zGuildsRes.parse(guilds);
};
