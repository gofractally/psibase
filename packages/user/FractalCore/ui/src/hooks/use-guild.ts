import { useQuery } from "@tanstack/react-query";

import { getGuildBySlug } from "@/lib/graphql/fractals/getGuildBySlug";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

import { useGuildAccount } from "./use-guild-id";

export const useGuild = (optionalGuildAccount?: OptionalAccount) => {
    const guildAccountByRoute = useGuildAccount();
    const guildAccount = optionalGuildAccount || guildAccountByRoute;

    return useQuery({
        queryKey: QueryKey.guild(guildAccount),
        queryFn: async () => {
            return getGuildBySlug(guildAccount!);
        },
        staleTime: 10000,
        enabled: !!guildAccount,
    });
};
