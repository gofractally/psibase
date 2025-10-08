import { graphql } from "@/lib/graphql";

const qs = {
    userTokenBalances: (username: string) => `
        userBalances(user: "${username}") {
            nodes {
                tokenId
                balance
                symbol
                precision
            }
        }	
    `,
    userTokenBalanceChanges: (username: string, tokenId: number) => `
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
    `,
    userCredits: (username: string) => `
        userCredits(user: "${username}") {
            nodes {
                token {
                    id
                    symbol
                    precision
                }
                balance
                creditor
                debitor
            }
        }
    `,
    userDebits: (username: string) => `
        userDebits(user: "${username}") {
            nodes {
                token {
                    id
                    symbol
                    precision
                }
                balance
                creditor
                debitor
            }
        }
    `,
};

// User Token Balances
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

export const fetchUserTokenBalances = async (username: string) => {
    const query = `{${qs.userTokenBalances(username)}}`;
    const res = await graphql<UserTokenBalanceRes>(query, "tokens");
    return res.userBalances.nodes;
};

// User Token Balance Changes
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

export const fetchUserTokenBalanceChanges = async (
    username: string,
    tokenId: number,
) => {
    const query = `{${qs.userTokenBalanceChanges(username, tokenId)}}`;
    const res = await graphql<BalChangeRes>(query, "tokens");
    return res.balChanges.nodes;
};

// Open Lines of Credit
interface OpenLinesOfCreditRes {
    userCredits: LineOfCredit;
    userDebits: LineOfCredit;
}

interface LineOfCredit {
    nodes: LineOfCreditNode[];
}

export interface LineOfCreditNode {
    token: { id: number; symbol: string; precision: number };
    balance: string;
    creditor: string;
    debitor: string;
}

export const fetchOpenLinesOfCredit = async (username: string) => {
    const query = `{
        ${qs.userCredits(username)}
        ${qs.userDebits(username)}
    }`;

    const res = await graphql<OpenLinesOfCreditRes>(query, "tokens");
    return {
        credits: res.userCredits.nodes,
        debits: res.userDebits.nodes,
    };
};
