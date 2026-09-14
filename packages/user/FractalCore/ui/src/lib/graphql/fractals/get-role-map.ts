import { z } from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { guilds } from "@shared/lib/plugins";
import { Account, zAccount } from "@shared/lib/schemas/account";

const zMapping = z.object({
    fractal: zAccount,
    roleId: z.number().int(),
    guild: zAccount
});
export type Mapping = z.infer<typeof zMapping>;

export const getRoleMap = async (fractalAccount: Account, roleId: number): Promise<Mapping> => {
    const res = await callGraphqlViaPlugin(
        guilds.authorized.graphql,
        `
        {
            roleMap(fractal: "${fractalAccount}", roleId: ${roleId}) {
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
