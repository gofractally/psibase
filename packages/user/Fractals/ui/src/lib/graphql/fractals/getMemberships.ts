import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { Account, zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";

import { graphql } from "../../graphql";

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
        siblingUrl(null, "fractals", "/graphql"),
    );

    return z
        .object({
            memberships: z.object({
                nodes: zMember,
            }),
        })
        .parse(res).memberships.nodes;
};
