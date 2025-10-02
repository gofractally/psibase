import { z } from "zod";

import { zAccount } from "@/lib/zod/Account";

import { graphql } from "../../graphql";
import { siblingUrl } from "@psibase/common-lib";

export const zFractaListInstance = z.object({
    account: zAccount,
    name: z.string(),
    mission: z.string(),
});

export type FractalListInstance = z.infer<typeof zFractaListInstance>;

export const getFractals = async () => {
    const res = await graphql(`
        {
            fractals(first: 99) {
                nodes {
                    account
                    name
                    mission
                }
            }
        }
    `, siblingUrl(null, 'fractals', '/graphql'));

    return z
        .object({
            fractals: z.object({
                nodes: zFractaListInstance.array(),
            }),
        })
        .parse(res).fractals.nodes;
};
