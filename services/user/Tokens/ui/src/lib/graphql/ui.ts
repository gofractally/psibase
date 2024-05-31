import { graphql } from "./index";
export interface Root {
  data: Data;
}

export interface Data {
  userBalances: User;
  userTokens: UserTokens;
  userCredits: User;
  userDebits: User;
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
  symbolId: string;
  precision: Precision;
  creditedTo?: string;
  debitableFrom?: string;
}

export interface Precision {
  value: number;
}

export interface UserTokens {
  edges: UserTokensEdge[];
}

export interface UserTokensEdge {
  node: UserBalanceToken;
}

export interface UserBalanceToken {
  id: number;
  precision: Precision;
  symbolId: string;
}

const queryString = (username: string) => `
{
	
	userBalances(user: "${username}") {
		edges {
			node {
				tokenId
				balance
				symbolId
				precision {
					value
				}
			}
		}
	}

	userTokens(user: "${username}") {
		edges {
			node {
				id
				precision { 
				  value
				}
				symbolId
			}
		}
	}
	
	userCredits(user: "${username}") {
		edges {
			node {
				symbolId
				tokenId
				precision {
					value
				}
				balance
				creditedTo
			}
		}
	}
	
	userDebits(user: "${username}") {
		edges {
			node {
				symbolId
				tokenId
				precision {
					value
				}
				balance
				debitableFrom
			}
		}
	}
	
}

`;

export const fetchUi = async (username: string) => {
  const res = await graphql<Data>(queryString(username));

  return {
    userDebits: res.userDebits.edges.map(({ node }) => node),
    userCredits: res.userCredits.edges.map(({ node }) => node),
    userBalances: res.userBalances.edges.map(({ node }) => node),
    userTokens: res.userTokens.edges.map(({ node }) => node),
  };
};
