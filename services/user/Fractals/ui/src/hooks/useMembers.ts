import { getMembers } from "@/lib/graphql/getMembers";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";
import { zAccount } from "@/lib/zodTypes";
import { useQuery } from "@tanstack/react-query";

export const useMembers = (account: OptionalAccount) =>
  useQuery({
    queryKey: QueryKey.members(account),
    enabled: !!account,
    queryFn: async () => getMembers(zAccount.parse(account)),
  });
