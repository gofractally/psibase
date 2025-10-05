import { useQuery } from "@tanstack/react-query";

import { getGuildApplications } from "@/lib/graphql/fractals/getGuildApplications";
import QueryKey, { OptionalNumber } from "@/lib/queryKeys";

export const useGuildApplications = (guildId: OptionalNumber) =>
    useQuery({
        queryKey: QueryKey.guildApplications(guildId),
        enabled: !!guildId,
        queryFn: async () => {
            return getGuildApplications(guildId!);
        },
    });
