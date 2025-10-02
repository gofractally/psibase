import { z } from "zod";

import { Account, zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";

import { graphql } from "../../graphql";
import { siblingUrl } from "@psibase/common-lib";

export const zFractal = z
    .object({
        account: zAccount,
        createdAt: zDateTime,
        name: z.string(),
        mission: z.string(),
    })
    .or(z.null());

const zFractalRes = z.object({
    fractal: zFractal,
    guilds: z.object({
        nodes: z
            .object({
                id: z.number(),
                rep: z.object({
                    member: zAccount
                }).optional(),
                displayName: z.string(),
                council: z.array(zAccount),
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
            mission
            name
        }
        guilds(fractal: "${owner}") {
            nodes {
                id
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
    }`, siblingUrl(null, 'fractals', '/graphql')
    );

    return zFractalRes.parse(fractal);
};
