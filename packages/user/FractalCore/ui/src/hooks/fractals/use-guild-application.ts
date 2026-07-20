import { useQuery } from "@tanstack/react-query";

import { getGuildApplication } from "@/lib/graphql/fractals/get-guild-application";
import QueryKey, { OptionalAccount } from "@/lib/query-keys";

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
