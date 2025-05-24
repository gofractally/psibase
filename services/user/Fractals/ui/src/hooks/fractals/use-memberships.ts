import { useQuery } from "@tanstack/react-query";

import { getMemberships } from "@/lib/graphql/fractals/getMemberships";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

export const useMemberships = (user: OptionalAccount) =>
    useQuery({
        queryKey: QueryKey.memberships(user),
        enabled: !!user,
        queryFn: async () => getMemberships(user!),
    });
