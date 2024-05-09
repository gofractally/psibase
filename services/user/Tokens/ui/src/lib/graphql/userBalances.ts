import { Quantity } from "../quantity";
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

export const fetchUserBalances = async (username: string) => {
  const res = await graphql<{
    userBalances: {
      user: string;
      balance: string;
      precision: number;
      token: number;
      symbol: string;
    }[];
  }>(queryString(username));

  return res.userBalances.map((balance) => ({
    ...balance,
    quantity: new Quantity(balance.balance, balance.precision),
  }));
};
