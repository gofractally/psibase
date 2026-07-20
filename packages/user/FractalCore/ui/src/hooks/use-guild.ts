import { useQuery } from "@tanstack/react-query";

import { getGuild } from "@/lib/graphql/fractals/get-guild";
import QueryKey, { OptionalAccount } from "@/lib/query-keys";

import { useGuildAccount } from "./use-guild-account";

export const useGuild = (optionalGuildAccount?: OptionalAccount) => {
    const guildAccountByRoute = useGuildAccount();
    const guildAccount = optionalGuildAccount || guildAccountByRoute;

    return useQuery({
        queryKey: QueryKey.guild(guildAccount),
        queryFn: async () => {
            return await getGuild(guildAccount!);
        },
        staleTime: 10000,
        enabled: !!guildAccount,
    });
};
