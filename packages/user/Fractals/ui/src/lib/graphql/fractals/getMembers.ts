import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { zDateTime } from "@/lib/zod/DateTime";

import { MemberStatus } from "@shared/domains/fractal/lib/schemas/MemberStatus";
import { type Account, zAccount } from "@shared/lib/schemas/account";

import { graphql } from "../../graphql";

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
        siblingUrl(null, "fractals", "/graphql"),
    );

    return z
        .object({
            members: z.object({
                nodes: zMemberListInstance.array(),
            }),
        })
        .parse(member).members.nodes;
};
