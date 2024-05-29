import { fetchUi } from "@/lib/graphql/ui";
import { Quantity } from "@/lib/quantity";
import QueryKey from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";

export interface Token {
  id: number;
  balance?: Quantity;
  owner: string;
  isAdmin: boolean;
  symbol: string;
  label: string;
}

export interface SharedBalance {
  id: string;
  tokenId: number;
  creditor: string;
  debitor: string;
  label: string;
  amount: Quantity;
}

export const useUi = (username: string | undefined) =>
  useQuery({
    queryKey: QueryKey.ui(username),
    enabled: !!username,
    refetchInterval: 10000,
    queryFn: async () => {
      const res = await fetchUi(username!);

      const creditBalances = res.userCredits.map((credit): SharedBalance => {
        const amount = new Quantity(
          credit.balance,
          credit.precision.value,
          credit.tokenId,
          credit.symbolId
        );
        return {
          amount,
          creditor: username || "",
          debitor: credit.creditedTo!,
          id: credit.tokenId.toString() + credit.creditedTo! + username || "",
          label: amount.label(),
          tokenId: credit.tokenId,
        };
      });

      // TODO: the response seems to be the same as credit balances
      // @ts-ignore
      const debitBalances = res.userDebits.map((debit): SharedBalance => {
        const amount = new Quantity(
          debit.balance,
          debit.precision.value,
          debit.tokenId,
          debit.symbolId
        );
        return {
          amount,
          creditor: debit.debitableFrom!,
          debitor: username || "",
          id: debit.tokenId.toString() + debit.debitableFrom! + username || "",
          label: amount.label(),
          tokenId: debit.tokenId,
        };
      });

      const sharedBalances: SharedBalance[] = [...creditBalances, ...[]];

      const userBalanceTokens: Token[] = res.userBalances.map(
        (balance): Token => {
          const quan = new Quantity(
            balance.balance,
            balance.precision.value,
            balance.tokenId,
            balance.symbolId
          );

          return {
            id: balance.tokenId,
            owner: "",
            isAdmin: res.userTokens.some((user) => user.id == balance.tokenId),
            symbol: balance.symbolId,
            label: quan.label(),
            balance: quan,
          };
        }
      );

      const userTokens = res.userTokens.map((userToken): Token => {
        const quan = new Quantity(
          "1",
          userToken.precision.value,
          userToken.id,
          userToken.symbolId
        );
        return {
          id: userToken.id,
          isAdmin: true,
          label: quan.label(),
          owner: username || "",
          symbol: userToken.symbolId,
        };
      });
      const tokens = [...userBalanceTokens, ...userTokens].filter(
        (token, index, arr) => arr.findIndex((t) => t.id == token.id) == index
      );

      return { tokens, sharedBalances };
    },
    initialData: {
      sharedBalances: [],
      tokens: [],
    },
  });
