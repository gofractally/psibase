import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";
import { MemberStatus } from "@/lib/zod/MemberStatus";

import { graphql } from "@shared/lib/graphql";
import { Account, zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

export const zMember = z
    .object({
        fractal: zAccount,
        account: zAccount,
        createdAt: zDateTime,
        memberStatus: z.nativeEnum(MemberStatus),
    })
    .or(z.null());

export type Membership = z.infer<typeof zMember>;

export const getMembership = async (
    fractalAccount: Account,
    account: Account,
): Promise<Membership> => {
    const member = await graphql(
        `
    {
        member(fractal: "${fractalAccount}", member: "${account}") {     
            fractal
            account
            createdAt
            memberStatus

        } 
    }`,
        { service: FRACTALS_SERVICE },
    );

    return z
        .object({
            member: zMember,
        })
        .parse(member).member;
};
