import { graphql } from "@/lib/graphql";

interface UserTokenBalanceRes {
    userBalances: UserTokenBalance;
}

interface UserTokenBalance {
    nodes: UserTokenBalanceNode[];
}

export interface UserTokenBalanceNode {
    tokenId: number;
    balance: string;
    symbol: string;
    precision: number;
}

interface BalChangeRes {
    balChanges: BalChange;
}

export interface BalChange {
    nodes: BalChangeNode[];
}

export interface BalChangeNode {
    tokenId: number;
    account: string;
    counterParty: string;
    action: "credited" | "debited" | "uncredited" | "rejected";
    amount: string;
    memo: string;
}

const qs = {
    userTokenBalances: (username: string) => `
        {	
            userBalances(user: "${username}") {
                nodes {
                    tokenId
                    balance
                    symbol
                    precision
                }
            }	
        }
    `,
    userTokenBalanceChanges: (username: string, tokenId: number) => `
        {
            balChanges(tokenId: ${tokenId}, account: "${username}") {
                nodes {
                    tokenId
                    account
                    counterParty
                    action
                    amount
                    memo
                }
            }
        }
    `,
};

export const fetchUserTokenBalances = async (username: string) => {
    const res = await graphql<UserTokenBalanceRes>(
        qs.userTokenBalances(username),
        "tokens",
    );
    return res.userBalances.nodes;
};

export const fetchUserTokenBalanceChanges = async (
    username: string,
    tokenId: number,
) => {
    const res = await graphql<BalChangeRes>(
        qs.userTokenBalanceChanges(username, tokenId),
        "tokens",
    );
    return res.balChanges.nodes;
};
