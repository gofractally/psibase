import { z } from "zod";

import { FRACTALS_SERVICE } from "@shared/domains/fractal/lib/constants";
import { graphql } from "@shared/lib/graphql";
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
    const res = await graphql(
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
        { service: FRACTALS_SERVICE },
    );

    return z
        .object({
            memberships: z.object({
                nodes: zMember,
            }),
        })
        .parse(res).memberships.nodes;
};
