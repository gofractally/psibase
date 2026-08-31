import { z } from "zod";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import { tokens } from "@shared/lib/plugins";
import { zAccount } from "@shared/lib/schemas/account";

const userTokenBalancesQuery = (username: string) => `
    userBalances(user: "${username}") {
        nodes {
            tokenId
            balance
            symbol
            precision
            account
        }
    }
`;

export const zUserTokenBalanceNodeSchema = z.object({
    tokenId: z.number(),
    balance: z.string(),
    symbol: z.string().nullable(),
    precision: z.number(),
    account: zAccount,
});

const zUserTokenBalanceSchema = z.object({
    userBalances: z.object({
        nodes: z.array(zUserTokenBalanceNodeSchema),
    }),
});

export type UserTokenBalanceNode = z.infer<typeof zUserTokenBalanceNodeSchema>;

export const fetchUserTokenBalances = async (username: string) => {
    const parsedUsername = zAccount.parse(username);
    const query = `{${userTokenBalancesQuery(parsedUsername)}}`;
    const data = await authorizedPluginGraphql<
        z.infer<typeof zUserTokenBalanceSchema>
    >(tokens.authorized.graphql, query);
    const parsed = zUserTokenBalanceSchema.parse(data);
    return parsed.userBalances.nodes;
};
