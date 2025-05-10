import { getMembers } from "@/lib/graphql/fractals/getMembers";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";
import { useQuery } from "@tanstack/react-query";

export const useMembers = (account: OptionalAccount) =>
  useQuery({
    queryKey: QueryKey.members(account),
    enabled: !!account,
    queryFn: async () => getMembers(zAccount.parse(account)),
  });
