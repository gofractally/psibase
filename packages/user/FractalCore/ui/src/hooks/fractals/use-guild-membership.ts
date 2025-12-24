import { useQuery } from "@tanstack/react-query";

import { getGuildMembership } from "@/lib/graphql/fractals/getGuildMembership";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

import { useCurrentUser } from "../use-current-user";
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
            try {
                const res = await getGuildMembership(
                    guildAccount!,
                    memberAccount!,
                );
                return res;
            } catch (e) {
                console.error("bad", e);
                throw new Error("f");
            }
        },
    });
};
