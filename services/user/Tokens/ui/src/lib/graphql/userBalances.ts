import { graphql } from "./index";

const queryString = (username: string) => `
{
    userBalances(user: "${username}") {
		user
		balance
		precision
		token
		symbol
	}
}
`;

export const fetchUserBalances = (username: string) =>
  graphql<{
    userBalances: {
      user: string;
      balance: string;
      precision: number;
      token: number;
      symbol: string;
    }[];
  }>(queryString(username));
