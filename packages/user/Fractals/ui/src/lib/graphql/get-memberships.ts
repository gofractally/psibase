import { z } from "zod";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import { fractals } from "@shared/lib/plugins";
import { type Account, zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

export const zMember = z
    .object({
        fractal: zAccount,
        createdAt: zDateTime,
        fractalDetails: z.object({
            account: zAccount,
        }),
    })
    .array();

export type Membership = z.infer<typeof zMember>;

export const getMemberships = async (account: Account): Promise<Membership> => {
    const res = await authorizedPluginGraphql(
        fractals.authorized.graphql,
        `
        {
            memberships(member: "${account}") {
                nodes {
                    fractal
                    createdAt
                    fractalDetails {
                        account
                    }
                }
            }
        }
    `,
    );

    return z
        .object({
            memberships: z.object({
                nodes: zMember,
            }),
        })
        .parse(res).memberships.nodes;
};
