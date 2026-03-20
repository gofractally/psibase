import { useQuery } from "@tanstack/react-query";

import { getGuildMemberships } from "@/lib/graphql/guild/getGuildMemberships";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";


export const useGuildMembershipsOfUser = (user: OptionalAccount) => useQuery({
    queryKey: QueryKey.memberships(user),
    enabled: !!user,
    queryFn: async () => {
        return getGuildMemberships(user!)
    },
})