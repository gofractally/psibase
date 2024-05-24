import { graphql } from "./index";
import { z } from "zod";

export const PrecisionSchema = z.object({
  value: z.number(),
});
export type Precision = z.infer<typeof PrecisionSchema>;

export const NodeSchema = z.object({
  tokenId: z.number(),
  balance: z.string(),
  symbolId: z.string(),
  precision: PrecisionSchema,
  creditedTo: z.string().optional(),
  debitableFrom: z.string().optional(),
});
export type Node = z.infer<typeof NodeSchema>;

export const EdgeSchema = z.object({
  node: NodeSchema,
});
export type Edge = z.infer<typeof EdgeSchema>;

export const UserSchema = z.object({
  edges: z.array(EdgeSchema),
});
export type User = z.infer<typeof UserSchema>;

export const DataSchema = z.object({
  userBalances: UserSchema,
  userCredits: UserSchema,
  userDebits: UserSchema,
});
export type Data = z.infer<typeof DataSchema>;

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
  const res = await graphql<z.infer<typeof DataSchema>>(queryString(username));

  console.log(res, "is the big query fetchUi");

  return {
    userDebits: res.userDebits.edges.map(({ node }) => node),
    userCredits: res.userCredits.edges.map(({ node }) => node),
    userBalances: res.userBalances.edges.map(({ node }) => node),
  };
};
