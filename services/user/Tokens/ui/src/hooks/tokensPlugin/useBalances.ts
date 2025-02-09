import { fetchUi } from "@/lib/graphql/ui";
import { Quantity } from "@/lib/quantity";
import QueryKey from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

export interface Token {
  id: number;
  balance?: Quantity;
  owner: string;
  isAdmin: boolean;
  symbol: string;
  label: string;
  precision: number;
}

export interface SharedBalance {
  id: string;
  tokenId: number;
  creditor: string;
  debitor: string;
  label: string;
  amount: Quantity;
}

export interface BalanceRes {
  tokens: Token[];
  sharedBalances: SharedBalance[];
}

let toasted = false;

export const useBalances = (username: string | undefined | null) =>
  useQuery<BalanceRes>({
    queryKey: QueryKey.ui(username || "undefined"),
    enabled: !!username,
    refetchInterval: 10000,
    queryFn: async () => {
      if (!toasted) {
        toast("Fetching token balances...");
      }
      const res = await fetchUi(z.string().parse(username));

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
          label: amount.getDisplayLabel(),
          tokenId: credit.tokenId,
        };
      });

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
          label: amount.getDisplayLabel(),
          tokenId: debit.tokenId,
        };
      });

      const sharedBalances: SharedBalance[] = [
        ...creditBalances,
        ...debitBalances,
      ];

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
            precision: quan.getPrecision(),
            label: quan.getDisplayLabel(),
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
          label: quan.getDisplayLabel(),
          precision: userToken.precision.value,
          owner: username || "",
          symbol: userToken.symbolId,
        };
      });
      const tokens = [...userBalanceTokens, ...userTokens].filter(
        (token, index, arr) => arr.findIndex((t) => t.id == token.id) == index
      );

      if (!toasted) {
        toasted = true;
        toast.success("Fetched token balances");
      }
      return { tokens, sharedBalances };
    },
  });
