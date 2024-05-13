import { fetchUserBalances } from "@/lib/graphql/userBalances";
import { useQuery } from "@tanstack/react-query";

interface TokenBalance {
  label: string;
  amount: number;
  isAdmin: boolean;
  isGenericToken: boolean;
  id: string;
}

export const useTokenBalances = (user: string) =>
  useQuery({
    queryKey: ["balances", user],
    initialData: [],
    queryFn: async (): Promise<TokenBalance[]> => {
      const res = await fetchUserBalances("alice");
      console.log(res, "is the raw balances");
      return res.map(
        (balance): TokenBalance => ({
          amount: balance.quantity.toNumber(),
          id: balance.token.toString(),
          isAdmin: false,
          isGenericToken: !balance.symbol,
          label: `Token${balance.token}`,
        })
      );
    },
  });
