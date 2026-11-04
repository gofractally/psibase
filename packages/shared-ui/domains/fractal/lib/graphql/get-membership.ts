import { z } from "zod";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { fractals } from "@shared/lib/plugins";
import { Account, zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

export const zMember = z
    .object({
        fractal: zAccount,
        account: zAccount,
        createdAt: zDateTime,
    })
    .or(z.null());

export type Membership = z.infer<typeof zMember>;

export const getMembership = async (
    fractalAccount: Account,
    account: Account,
): Promise<Membership> => {
    const member = await graphqlAuth(
        fractals.authorized.graphql,
        `
    {
        member(fractal: "${fractalAccount}", member: "${account}") {     
            fractal
            account
            createdAt

        } 
    }`,
    );

    return z
        .object({
            member: zMember,
        })
        .parse(member).member;
};
