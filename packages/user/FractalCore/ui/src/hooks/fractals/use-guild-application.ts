import { useQuery } from "@tanstack/react-query";

import { getGuildApplication } from "@/lib/graphql/fractals/getGuildApplication";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

export const useGuildApplication = (
    guildAccount: OptionalAccount,
    applicantAccount: OptionalAccount,
) =>
    useQuery({
        queryKey: QueryKey.guildApplication(guildAccount, applicantAccount),
        enabled: !!(guildAccount && applicantAccount),
        queryFn: async () => {
            return getGuildApplication(guildAccount!, applicantAccount!);
        },
    });
