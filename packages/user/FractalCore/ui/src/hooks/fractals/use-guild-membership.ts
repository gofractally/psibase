import { useQuery } from "@tanstack/react-query";

import { getGuildMembership } from "@/lib/graphql/fractals/get-guild-membership";
import QueryKey, { OptionalAccount } from "@/lib/query-keys";

import { useCurrentUser } from "@shared/hooks/use-current-user";

import { useGuildAccount } from "../use-guild-account";

export const useGuildMembership = (
    guild?: OptionalAccount,
    user?: OptionalAccount,
) => {
    const { data: currentUser } = useCurrentUser();
    const guildSlug = useGuildAccount();

    const memberAccount = user || currentUser;
    const guildAccount = guild || guildSlug;

    return useQuery({
        queryKey: QueryKey.guildMembership(guildAccount, memberAccount),
        enabled: !!memberAccount && !!guildAccount,
        queryFn: async () => {
            const res = await getGuildMembership(
                guildAccount!,
                memberAccount!,
            );
            return res;
        },
    });
};
