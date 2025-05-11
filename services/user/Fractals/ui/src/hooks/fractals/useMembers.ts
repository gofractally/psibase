import { useQuery } from "@tanstack/react-query";

import { getMembers } from "@/lib/graphql/fractals/getMembers";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { useCurrentFractal } from "../useCurrentFractal";

export const useMembers = (accountParam?: OptionalAccount) => {
    const account = accountParam || useCurrentFractal();

    return useQuery({
        queryKey: QueryKey.members(account),
        enabled: !!account,
        queryFn: async () => getMembers(zAccount.parse(account)),
    });
};
