import { z } from "zod";

import { callPluginFunction, tokens } from "@shared/lib/plugins";
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

type AuthorizedGraphqlResponse<T> = {
    data: T;
    errors?: Array<{ message: string }>;
};

function parseAuthorizedGraphqlResponse<T>(result: string): T {
    const response = JSON.parse(result) as AuthorizedGraphqlResponse<T>;
    if (response.errors?.length) {
        throw new Error(response.errors[0].message);
    }
    return response.data;
}

export const fetchUserTokenBalances = async (username: string) => {
    const parsedUsername = zAccount.parse(username);
    const query = `{${userTokenBalancesQuery(parsedUsername)}}`;
    const result = await callPluginFunction(tokens.authorized.graphql, [query]);
    const data = parseAuthorizedGraphqlResponse<
        z.infer<typeof zUserTokenBalanceSchema>
    >(result);
    const parsed = zUserTokenBalanceSchema.parse(data);
    return parsed.userBalances.nodes;
};
