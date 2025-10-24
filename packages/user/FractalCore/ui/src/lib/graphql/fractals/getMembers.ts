import { z } from "zod";

import { fractalsService } from "@/lib/constants";
import { Account, zAccount } from "@/lib/zod/Account";
import { zDateTime } from "@/lib/zod/DateTime";
import { MemberStatus } from "@/lib/zod/MemberStatus";

import { derp } from "../../graphql";

export const zMemberListInstance = z.object({
    account: zAccount,
    createdAt: zDateTime,
    memberStatus: z.nativeEnum(MemberStatus),
});

export type MembershipListInstance = z.infer<typeof zMemberListInstance>;

export const getMembers = async (fractalAccount: Account) => {
    const member = await derp(
        `
    {
        members(fractal: "${fractalAccount}") {
            nodes {     
                account
                memberStatus
                createdAt
        }} 
    }`,
        fractalsService,
    );

    return z
        .object({
            members: z.object({
                nodes: zMemberListInstance.array(),
            }),
        })
        .parse(member).members.nodes;
};
