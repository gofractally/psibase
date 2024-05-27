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
    queryFn: async () => {
      const res = await fetchUi(username!);

      const creditBalances = res.userCredits.map(
        (credit): SharedBalance => ({
          amount: new Quantity(credit.balance, credit.precision.value),
          creditor: username || "",
          debitor: credit.creditedTo!,
          id: credit.tokenId.toString() + credit.creditedTo! + username || "",
          label: credit.symbolId || `Token ${credit.tokenId}`,
          tokenId: credit.tokenId,
        })
      );

      const debitBalances = res.userDebits.map(
        (debit): SharedBalance => ({
          amount: new Quantity(debit.balance, debit.precision.value),
          creditor: debit.debitableFrom!,
          debitor: username || "",
          id: debit.tokenId.toString() + debit.debitableFrom! + username || "",
          label: debit.symbolId || `Token ${debit.tokenId}`,
          tokenId: debit.tokenId,
        })
      );

      const sharedBalances: SharedBalance[] = [
        ...creditBalances,
        ...debitBalances,
      ];

      const tokens: Token[] = res.userBalances.map(
        (balance): Token => ({
          id: balance.tokenId,
          owner: "",
          isAdmin: true,
          symbol: balance.symbolId,
          label: balance.symbolId
            ? balance.symbolId
            : `Token${balance.tokenId}`,
          balance: new Quantity(balance.balance, balance.precision.value),
        })
      );

      return { tokens, sharedBalances };
    },
    initialData: {
      sharedBalances: [],
      tokens: [],
    },
  });
