import { useQuery } from "@tanstack/react-query";

import { getGuildApplications } from "@/lib/graphql/fractals/get-guild-applications";
import QueryKey, { OptionalAccount } from "@/lib/query-keys";

export const useGuildApplications = (guildAccount: OptionalAccount) =>
    useQuery({
        queryKey: QueryKey.guildApplications(guildAccount),
        enabled: !!guildAccount,
        queryFn: async () => {
            return getGuildApplications(guildAccount!);
        },
    });
