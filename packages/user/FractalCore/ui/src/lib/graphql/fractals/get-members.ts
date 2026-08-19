import { z } from "zod";

import { FRACTALS_SERVICE } from "@shared/domains/fractal/lib/constants";
import { graphql } from "@shared/lib/graphql";
import { Account, zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

export const zMemberListInstance = z.object({
    account: zAccount,
    createdAt: zDateTime,
});

export type MembershipListInstance = z.infer<typeof zMemberListInstance>;

export const getMembers = async (fractalAccount: Account) => {
    const member = await graphql(
        `
    {
        members(fractal: "${fractalAccount}") {
            nodes {     
                account
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
