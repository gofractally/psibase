import { Quantity } from "../quantity";
import { graphql } from "./index";

export interface Data {
  sharedBalances: SharedBalances;
  tokens: Tokens;
  userBalances: UserBalance[];
}

export interface SharedBalances {
  edges: SharedBalancesEdge[];
}

export interface SharedBalancesEdge {
  node: PurpleNode;
}

export interface PurpleNode {
  balance: string;
  key: Key;
}

export interface Key {
  creditor: string;
  debitor: string;
  tokenId: number;
}

export interface Tokens {
  edges: TokensEdge[];
}

export interface TokensEdge {
  node: FluffyNode;
}

export interface FluffyNode {
  id: number;
  ownerNft: number;
  precision: Precision;
  symbolId: string;
}

export interface Precision {
  value: number;
}

export interface UserBalance {
  user: string;
  balance: string;
  precision: number;
  token: number;
  symbol: string;
}

const queryString = (username: string) => `
{
	sharedBalances(first: 500) {
		edges {
			node {
				balance
				key {
					creditor
					debitor
					tokenId
				}
			}
		}
	}

	tokens(gt: 1) {
		edges {
			node {
				id
				ownerNft
				precision {
					value
				}
				symbolId
			}
		}
	}

	userBalances(user: "${username}") {
		user
		balance
		precision
		token
		symbol
	}
}

`;

export const fetchUi = async (username: string) => {
  const res = await graphql<Data>(queryString(username));

  console.log(res, "is the big query");

  const tokens = res.tokens.edges.map((edge) => ({
    symbol: edge.node.symbolId,
    id: edge.node.id,
    precision: edge.node.precision.value,
  }));

  return {
    sharedBalances: res.sharedBalances.edges.map((edge) => {
      const foundToken = tokens.find(
        (token) => token.id == edge.node.key.tokenId
      );
      const { creditor, debitor, tokenId } = edge.node.key;

      return {
        id: `${creditor}-${debitor}-${tokenId}`,
        tokenId: edge.node.key.tokenId,
        creditor,
        debitor,
        balance: edge.node.balance,
        ...(foundToken && {
          quantity: new Quantity(edge.node.balance, foundToken.precision),
        }),
      };
    }),
    tokens,
    userBalances: res.userBalances.map((balance) => ({
      quantity: new Quantity(balance.balance, balance.precision),
      tokenId: balance.token,
      user: balance.user,
      symbol: balance.symbol,
    })),
  };
};
