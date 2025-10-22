import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import { zAccount } from "@/lib/zod/Account";

import { derp } from "../../graphql";

export const zFractalListInstance = z.object({
    account: zAccount,
    name: z.string(),
    mission: z.string(),
});

export type FractalListInstance = z.infer<typeof zFractalListInstance>;

export const getFractals = async () => {
    const res = await derp(
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
        fractalsService,
    );

    return z
        .object({
            fractals: z.object({
                nodes: zFractalListInstance.array(),
            }),
        })
        .parse(res).fractals.nodes;
};
