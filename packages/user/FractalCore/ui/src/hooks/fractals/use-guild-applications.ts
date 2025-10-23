import { useQuery } from "@tanstack/react-query";

import { getGuildApplications } from "@/lib/graphql/fractals/getGuildApplications";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

export const useGuildApplications = (guildAccount: OptionalAccount) =>
    useQuery({
        queryKey: QueryKey.guildApplications(guildAccount),
        enabled: !!guildAccount,
        queryFn: async () => {
            return getGuildApplications(guildAccount!);
        },
    });
