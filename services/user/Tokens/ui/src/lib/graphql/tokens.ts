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

export const fetchTokens = () => graphql<GraphQlRes>(queryString());
