import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";
import { zDateTime } from "@/lib/zod/DateTime";
import { MemberStatus } from "@/lib/zod/MemberStatus";

import { Account, zAccount } from "@shared/lib/schemas/account";

import { graphql } from "../../graphql";

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
        FRACTALS_SERVICE,
    );

    return z
        .object({
            member: zMember,
        })
        .parse(member).member;
};
