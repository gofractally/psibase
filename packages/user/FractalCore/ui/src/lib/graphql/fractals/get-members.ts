import { z } from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { fractals } from "@shared/lib/plugins";
import { Account, zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

export const zMemberListInstance = z.object({
    account: zAccount,
    createdAt: zDateTime,
});

export type MembershipListInstance = z.infer<typeof zMemberListInstance>;

export const getMembers = async (fractalAccount: Account) => {
    const member = await callGraphqlViaPlugin(
        fractals.authorized.graphql,
        `
    {
        members(fractal: "${fractalAccount}") {
            nodes {     
                account
                createdAt
        }} 
    }`,
    );

    return z
        .object({
            members: z.object({
                nodes: zMemberListInstance.array(),
            }),
        })
        .parse(member).members.nodes;
};
