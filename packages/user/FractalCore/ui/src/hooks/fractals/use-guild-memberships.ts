import { useQuery } from "@tanstack/react-query";

import { getGuildMemberships } from "@/lib/graphql/fractals/getGuildMembership";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

import { useFractalAccount } from "./use-fractal-account";

export const useGuildMembershipsOfUser = (user: OptionalAccount) => {
    const fractal = useFractalAccount();
    return useQuery({
        queryKey: QueryKey.guildMemberships(user),
        enabled: !!fractal && !!user,
        queryFn: async () => {
            try {
                return (await getGuildMemberships(user!)).filter(
                    (membership) =>
                        membership.guild.fractal.account === fractal,
                );
            } catch (error) {
                const message = "Error getting memberships";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
};
