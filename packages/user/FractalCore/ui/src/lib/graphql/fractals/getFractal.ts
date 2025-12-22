import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";
import { zDateTime } from "@/lib/zod/DateTime";

import { Account, zAccount } from "@shared/lib/schemas/account";
import { zU8 } from "@shared/lib/schemas/u8";

import { graphql } from "../../graphql";

export const zFractal = z
    .object({
        account: zAccount,
        tokenInitThreshold: zU8,
        createdAt: zDateTime,
        name: z.string(),
        consensusReward: z
            .object({
                rankedGuilds: zAccount.array(),
                rankedGuildSlotCount: zU8,
                stream: z.object({
                    lastDistributed: zDateTime,
                    distIntervalSecs: z.number().int(),
                }),
            })
            .nullable(),
        mission: z.string(),
        judiciary: z.object({
            account: zAccount,
        }),
        legislature: z.object({
            account: zAccount,
        }),
    })
    .or(z.null());

export const zFractalRes = z.object({
    fractal: zFractal,
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

export type FractalRes = z.infer<typeof zFractalRes>;

export const getFractal = async (owner: Account): Promise<FractalRes> => {
    const fractal = await graphql(
        `
    {
        fractal(fractal: "${owner}") {     
            account
            tokenInitThreshold
            createdAt
            mission
            name
            consensusReward {
                rankedGuilds
                rankedGuildSlotCount
                stream {
                    lastDistributed
                    distIntervalSecs
                }
            }
            judiciary { 
                account
            }
            legislature { 
                account
            }
        }
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
        FRACTALS_SERVICE,
    );

    return zFractalRes.parse(fractal);
};
