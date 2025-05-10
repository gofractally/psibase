import { z } from "zod";

import { graphql } from "../../graphql";
import { Account, zAccount } from "@/lib/zod/Account";
import { MemberStatus } from "@/lib/zod/MemberStatus";
import { zDateTime } from "@/lib/zod/DateTime";

export const zMemberListInstance = z.object({
    account: zAccount,
    createdAt: zDateTime,
    reputation: z.number(),
    memberStatus: z.nativeEnum(MemberStatus),
});

export type MembershipListInstance = z.infer<typeof zMemberListInstance>;

export const getMembers = async (
    fractalAccount: Account,
) => {
    const member = await graphql(
        `
    {
        members(fractal: "${fractalAccount}") {
            nodes {     
                account
                reputation
                memberStatus
                createdAt
        }} 
    }`,
    );

    console.log({ member });
    return z
        .object({
            members: z.object({
                nodes: zMemberListInstance.array()
            }),
        })
        .parse(member).members.nodes;
};
