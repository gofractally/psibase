import { fetchUserBalances } from "@/lib/graphql/userBalances";
import QueryKey from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";

export const useTokenBalances = (user: string | undefined) =>
  useQuery({
    queryKey: QueryKey.tokenBalances(user),
    initialData: [],
    queryFn: async () => {
      return fetchUserBalances("alice");
    },
  });
