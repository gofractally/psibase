import { graphql } from "./index";

const queryString = (gt = 1) => `
{
	tokens(gt: ${gt}) {
		edges {
			node {
				id
				ownerNft
				precision {
					value
				}
				symbolId
				currentSupply {
					value
				}
				maxSupply {
					value
				}
				inflation {
					settings {
						dailyLimitPct
					}
				}
			}
		}
	}
}
`;

interface Value<T> {
  value: T;
}

type Quantity = Value<string>;
type Precision = Value<number>;

interface GraphQlRes {
  tokens: {
    edges: {
      node: {
        id: number;
        ownerNft: number;
        precision: Precision;
        symbolId: string;
        currentSupply: Quantity;
        maxSupply: Quantity;
      };
    }[];
  };
}

const parseValue = <T>(value: Value<T>): T => {
  return value.value;
};

export const fetchTokens = async (gt: number = 1) => {
  const res = await graphql<GraphQlRes>(queryString(gt));
  return res.tokens.edges.map((token) => ({
    ...token.node,
    currentSupply: parseValue(token.node.currentSupply),
    precision: parseValue(token.node.precision),
    maxSupply: parseValue(token.node.maxSupply),
  }));
};
