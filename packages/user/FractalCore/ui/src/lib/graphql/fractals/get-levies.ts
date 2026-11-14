import { z } from "zod";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { fractals } from "@shared/lib/plugins";
import { Account, zAccount } from "@shared/lib/schemas/account";

export const zLevy = z.object({
    id: z.number(),
    member: zAccount,
    payee: zAccount,
    ratePpm: z.number(),
    debt: z.object({
        value: z.union([z.string(), z.number()]).transform(String),
    }),
    sendToStream: z.boolean(),
});

export type Levy = z.infer<typeof zLevy>;

export const getLevies = async (fractalAccount: Account): Promise<Levy[]> => {
    const res = await graphqlAuth(
        fractals.authorized.graphql,
        `
        {
            levies(fractal: "${fractalAccount}") {
                nodes {
                    id
                    member
                    payee
                    ratePpm
                    debt { value }
                    sendToStream
                }
            }
        }
        `,
    );

    return z
        .object({
            levies: z.object({
                nodes: zLevy.array(),
            }),
        })
        .parse(res).levies.nodes;
};
