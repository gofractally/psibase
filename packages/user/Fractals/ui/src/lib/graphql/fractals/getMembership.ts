import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { Account, zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";
import { MemberStatus } from "@/lib/zod/MemberStatus";

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
        siblingUrl(null, "fractals", "/graphql"),
    );

    return z
        .object({
            member: zMember,
        })
        .parse(member).member;
};
