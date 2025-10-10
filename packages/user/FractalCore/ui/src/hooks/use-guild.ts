import { useQuery } from "@tanstack/react-query";

import { getGuild } from "@/lib/graphql/fractals/getGuild";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

import { useGuildAccount } from "./use-guild-account";

export const useGuild = (optionalGuildAccount?: OptionalAccount) => {
    const guildAccountByRoute = useGuildAccount();
    const guildAccount = optionalGuildAccount || guildAccountByRoute;

    return useQuery({
        queryKey: QueryKey.guild(guildAccount),
        queryFn: async () => {
            return getGuild(guildAccount!);
        },
        staleTime: 10000,
        enabled: !!guildAccount,
    });
};
