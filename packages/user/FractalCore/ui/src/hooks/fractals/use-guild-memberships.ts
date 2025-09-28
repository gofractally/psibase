import { useQuery } from "@tanstack/react-query";

import { getGuildMemberships } from "@/lib/graphql/fractals/getGuildMembership";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

export const useGuildMemberships = (
    fractal: OptionalAccount,
    user: OptionalAccount,
) =>
    useQuery({
        queryKey: QueryKey.guildMemberships(fractal, user),
        enabled: !!fractal && !!user,
        queryFn: async () => {
            try {
                return await getGuildMemberships(fractal!, user!);
            } catch (error) {
                const message = "Error getting memberships";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
