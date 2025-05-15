import { z } from "zod";

import { Account, zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";

import { graphql } from "../../graphql";

export const zFractalMembershipListInstance = z
    .object({
        name: z.string(),
        account: zAccount,
        createdAt: zDateTime,
        mission: z.string(),
    })
    .array();

export type FractalMembershipListInstance = z.infer<
    typeof zFractalMembershipListInstance
>;

export const getFractalMemberships = async (
    account: Account,
): Promise<FractalMembershipListInstance> => {
    const res = await graphql(`
        {
            fractalMemberships(member: "${account}") {
                name
                account
                mission
                createdAt
            }
        }
    `);

    console.log({ res });

    return z
        .object({
            fractalMemberships: zFractalMembershipListInstance,
        })
        .parse(res).fractalMemberships;
};
