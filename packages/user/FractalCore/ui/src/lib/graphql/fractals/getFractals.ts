import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { zAccount } from "@/lib/zod/Account";

import { graphql } from "../../graphql";

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
        siblingUrl(null, "fractals", "/graphql"),
    );

    return z
        .object({
            fractals: z.object({
                nodes: zFractalListInstance.array(),
            }),
        })
        .parse(res).fractals.nodes;
};
