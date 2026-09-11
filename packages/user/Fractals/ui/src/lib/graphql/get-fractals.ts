import { z } from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { fractals } from "@shared/lib/plugins";
import { zAccount } from "@shared/lib/schemas/account";

export const zFractaListInstance = z.object({
    account: zAccount,
    name: z.string(),
    mission: z.string(),
});

export type FractalListInstance = z.infer<typeof zFractaListInstance>;

export const getFractals = async () => {
    const res = await callGraphqlViaPlugin(
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
                nodes: zFractaListInstance.array(),
            }),
        })
        .parse(res).fractals.nodes;
};
