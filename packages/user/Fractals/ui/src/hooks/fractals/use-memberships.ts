import { useQuery } from "@tanstack/react-query";

import { getMemberships } from "@/lib/graphql/get-memberships";
import QueryKey, { OptionalAccount } from "@/lib/query-keys";

export const useMemberships = (user: OptionalAccount) =>
    useQuery({
        queryKey: QueryKey.memberships(user),
        enabled: !!user,
        queryFn: async () => {
            try {
                return await getMemberships(user!);
            } catch (error) {
                const message = "Error getting memberships";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
