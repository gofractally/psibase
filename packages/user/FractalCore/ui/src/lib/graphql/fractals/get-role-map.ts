import { z } from "zod";

import { GUILDS_SERVICE } from "@shared/domains/fractal/lib/constants";
import { graphql } from "@shared/lib/graphql";
import { Account, zAccount } from "@shared/lib/schemas/account";

const zMapping = z.object({
    fractal: zAccount,
    roleId: z.number().int(),
    guild: zAccount
});
export type Mapping = z.infer<typeof zMapping>;

export const getRoleMap = async (fractalAccount: Account, roleId: number): Promise<Mapping> => {
    const res = await graphql(
        `
        {
            roleMap(owner: "${fractalAccount}", roleId: ${roleId}) {
                edges {
                    node {
                        fractal
                        roleId
                        guild
                    }
                }
            }
        }
    `,
        { service: GUILDS_SERVICE },
    );

    const parsed = z
        .object({
            roleMap: z.object({
                edges: z.object({
                    node: zMapping
                }).array()
            }),
        })
        .parse(res);


    return zMapping.parse(parsed.roleMap.edges[0].node)
};
