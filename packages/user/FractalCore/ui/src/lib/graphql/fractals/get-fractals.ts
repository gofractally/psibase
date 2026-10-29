import { z } from "zod";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { fractals } from "@shared/lib/plugins";
import { zAccount } from "@shared/lib/schemas/account";

export const zFractalListInstance = z.object({
    account: zAccount,
    name: z.string(),
    mission: z.string(),
});

export type FractalListInstance = z.infer<typeof zFractalListInstance>;

export const getFractals = async () => {
    const res = await graphqlAuth(
        fractals.authorized.graphql,
        `
            {
                fractals(first: 99) {
                    nodes {
                        account
                        name
                        mission
                    }
                }
            }
        `,
    );

    return z
        .object({
            fractals: z.object({
                nodes: zFractalListInstance.array(),
            }),
        })
        .parse(res).fractals.nodes;
};
