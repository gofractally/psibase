import { fetchUi } from "@/lib/graphql/ui";
import QueryKey from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";

export const useUi = (username: string | undefined) =>
  useQuery({
    queryKey: QueryKey.ui(username),
    enabled: !!username,
    queryFn: () => fetchUi(username!),
    initialData: {
      sharedBalances: [],
      tokens: [],
      userBalances: [],
    },
  });
