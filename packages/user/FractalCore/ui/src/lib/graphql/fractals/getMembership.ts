import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import { Account, zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";
import { MemberStatus } from "@/lib/zod/MemberStatus";

import { derp } from "../../graphql";

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
    const member = await derp(
        `
    {
        member(fractal: "${fractalAccount}", member: "${account}") {     
            fractal
            account
            createdAt
            memberStatus

        } 
    }`,
        fractalsService,
    );

    return z
        .object({
            member: zMember,
        })
        .parse(member).member;
};
