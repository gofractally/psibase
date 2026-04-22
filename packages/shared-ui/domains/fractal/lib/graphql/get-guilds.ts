import { z } from "zod";

import { GUILDS_SERVICE } from "../constants";

import { graphql } from "@shared/lib/graphql";
import { Account, zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

export const zGuild = z
    .object({
        account: zAccount,
        createdAt: zDateTime,
        name: z.string(),
        stream: z.object({
            lastDistributed: zDateTime,
            distIntervalSecs: z.number().int(),
        }).nullable(),
        mission: z.string(),
        judiciary: z.object({
            account: zAccount,
        }),
        legislature: z.object({
            account: zAccount,
        }),
    })
    .or(z.null());

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

export const getGuilds = async (owner: Account): Promise<GuildsRes> => {
    const guilds = await graphql(
        `
    {
        guilds(fractal: "${owner}") {
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
