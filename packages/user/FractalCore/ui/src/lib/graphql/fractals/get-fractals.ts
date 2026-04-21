import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";

import { graphql } from "@shared/lib/graphql";
import { zAccount } from "@shared/lib/schemas/account";

export const zFractalListInstance = z.object({
    account: zAccount,
    name: z.string(),
    mission: z.string(),
});

export type FractalListInstance = z.infer<typeof zFractalListInstance>;

export const getFractals = async () => {
    const res = await graphql(
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
        { service: FRACTALS_SERVICE },
    );

    return z
        .object({
            fractals: z.object({
                nodes: zFractalListInstance.array(),
            }),
        })
        .parse(res).fractals.nodes;
};
