import { z } from "zod";

import { graphql } from "../graphql";
import { Account, MemberStatus, zAccount, zDateTime } from "../zodTypes";



export const zMember = z.object({
    fractal: zAccount,
    account: zAccount,
    createdAt: zDateTime,
    reputation: z.number(),
    memberStatus: z.nativeEnum(MemberStatus),
    rewardBalance: z.number(),
    rewardStartTime: zDateTime,
    rewardWait: z.number(),
});

export type Membership = z.infer<typeof zMember>;

export const zResult = zMember.or(z.null());

export type MembershipResult = z.infer<typeof zResult>;


export const getMembership = async (
    fractalAccount: Account,
    account: Account,
): Promise<z.infer<typeof zResult>> => {
    const member = await graphql(
        `
    {
        member(fractal: "${fractalAccount}", member: "${account}") {     
            fractal
            account
            createdAt
            reputation
            memberStatus
            rewardBalance
            rewardStartTime
            rewardWait
        } 
    }`,
    );

    console.log({ member });
    return z
        .object({
            member: zResult,
        })
        .parse(member).member;
};
