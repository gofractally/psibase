import { z } from "zod";

import { Account, zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";

import { graphql } from "../../graphql";

export const zFractal = z
    .object({
        account: zAccount,
        createdAt: zDateTime,
        name: z.string(),
        mission: z.string(),
        council: z.array(zAccount),
    })
    .or(z.null());

const zFractalRes = z.object({
    fractal: zFractal,
    guilds: z.object({
        nodes: z
            .object({
                id: z.number(),
                rep: zAccount.optional(),
                displayName: z.string(),
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

export const getFractal = async (owner: Account) => {
    const fractal = await graphql(
        `
    {
        fractal(fractal: "${owner}") {     
            account
            createdAt
            name
            mission
            council
        }
        guilds(fractal: "${owner}") {
            nodes {
                id
                rep
                displayName
                bio
                evalInstance {
                  evaluationId
                }
            }
        }
    }`,
    );

    return zFractalRes.parse(fractal);
};
