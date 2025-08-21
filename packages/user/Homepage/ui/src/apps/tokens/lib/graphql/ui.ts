import { graphql } from "@/lib/graphql";

export interface Root {
    data: Data;
}

export interface Data {
    userBalances: User;
    userTokens: UserBalanceToken[];
    userCredits: UserCreditDebit;
    userDebits: UserCreditDebit;
}

export interface User {
    edges: UserBalancesEdge[];
}

export interface UserBalancesEdge {
    node: SharedBalanceNode;
}

export interface SharedBalanceNode {
    tokenId: number;
    balance: string;
    symbol: string;
    precision: number;
}

export interface UserBalanceToken {
    id: number;
    precision: number;
    symbol: string;
}

export interface UserCreditDebit {
    edges: UserCreditDebitEdge[];
}

export interface UserCreditDebitEdge {
    node: UserCreditDebitNode;
}

export interface UserCreditDebitNode {
    symbol: string;
    tokenId: number;
    token: UserBalanceToken;
    balance: string;
    creditor: string;
    debitor: string;
}

const queryString = (username: string) => `
{
	
	userBalances(user: "${username}") {
		edges {
			node {
				tokenId
				balance
				symbol
				precision
			}
		}
	}

	userTokens(user: "${username}") {
		id
		precision
		symbol
	}
	
	userCredits(user: "${username}") {
		edges {
			node {
				symbol
				tokenId
				token {
					id
					precision
					symbol
				}
				balance
				creditor
				debitor
			}
		}
	}
	
	userDebits(user: "${username}") {
		edges {
			node {
				symbol
				tokenId
				token {
					id
					precision
					symbol
				}
				balance
				creditor
				debitor
			}
		}
	}
	
}

`;

export const fetchUi = async (username: string) => {
    const res = await graphql<Data>(queryString(username), "tokens");

    return {
        userDebits: res.userDebits.edges.map(({ node }) => node),
        userCredits: res.userCredits.edges.map(({ node }) => node),
        userBalances: res.userBalances.edges.map(({ node }) => node),
        userTokens: res.userTokens,
    };
};
