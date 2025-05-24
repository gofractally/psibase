import { z } from "zod";

import { Account, zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";

import { graphql } from "../../graphql";

export const zMember = z
    .object({
        fractal: zAccount,
        createdAt: zDateTime,
    })
    .array();

export type Membership = z.infer<typeof zMember>;

export const getMemberships = async (account: Account): Promise<Membership> => {
    const res = await graphql(`
        {
            memberships(member: "${account}") {
                nodes {
                    fractal
                    createdAt
                }
            }
        }
    `);

    console.log({ res });

    return z
        .object({
            memberships: zMember,
        })
        .parse(res).memberships;
};
