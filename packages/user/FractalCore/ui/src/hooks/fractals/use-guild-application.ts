import { useQuery } from "@tanstack/react-query";

import { getGuildApplication } from "@/lib/graphql/fractals/getGuildApplication";
import QueryKey, { OptionalAccount, OptionalNumber } from "@/lib/queryKeys";

export const useGuildApplication = (
    guildId: OptionalNumber,
    account: OptionalAccount,
) =>
    useQuery({
        queryKey: QueryKey.guildApplication(guildId, account),
        enabled: !!(guildId && account),
        queryFn: async () => {
            return getGuildApplication(guildId!, account!);
        },
    });
