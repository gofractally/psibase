import { fetchUserBalances } from "@/lib/graphql/userBalances";
import { useQuery } from "@tanstack/react-query";

export const useTokenBalances = (user: string) =>
  useQuery({
    queryKey: ["balances", user],
    initialData: [],
    queryFn: async () => {
      return fetchUserBalances("alice");
    },
  });
