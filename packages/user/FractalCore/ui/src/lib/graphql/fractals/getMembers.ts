import { z } from "zod";

import { FRACTALS_SERVICE } from "@/lib/constants";
import { zDateTime } from "@/lib/zod/DateTime";
import { MemberStatus } from "@/lib/zod/MemberStatus";

import { graphql } from "@shared/lib/graphql";
import { Account, zAccount } from "@shared/lib/schemas/account";

export const zMemberListInstance = z.object({
    account: zAccount,
    createdAt: zDateTime,
    memberStatus: z.nativeEnum(MemberStatus),
});

export type MembershipListInstance = z.infer<typeof zMemberListInstance>;

export const getMembers = async (fractalAccount: Account) => {
    const member = await graphql(
        `
    {
        members(fractal: "${fractalAccount}") {
            nodes {     
                account
                memberStatus
                createdAt
        }} 
    }`,
        { service: FRACTALS_SERVICE },
    );

    return z
        .object({
            members: z.object({
                nodes: zMemberListInstance.array(),
            }),
        })
        .parse(member).members.nodes;
};
