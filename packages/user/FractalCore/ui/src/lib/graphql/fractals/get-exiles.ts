import { z } from "zod";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { fractals } from "@shared/lib/plugins";
import { Account, zAccount } from "@shared/lib/schemas/account";

export const zExile = z.object({
    member: zAccount,
});

export type Exile = z.infer<typeof zExile>;

export const getExiles = async (fractalAccount: Account): Promise<Exile[]> => {
    const res = await graphqlAuth(
        fractals.authorized.graphql,
        `
        {
            exiles(fractal: "${fractalAccount}") {
                nodes {
                    member
                }
            }
        }
        `,
    );

    return z
        .object({
            exiles: z.object({
                nodes: zExile.array(),
            }),
        })
        .parse(res).exiles.nodes;
};
