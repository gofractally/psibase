import { useQuery } from "@tanstack/react-query";

import { getMembers } from "@/lib/graphql/fractals/getMembers";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { useCurrentFractal } from "../use-current-fractal";

export const useMembers = (accountParam?: OptionalAccount) => {
    const currentFractal = useCurrentFractal();
    const account = accountParam || currentFractal;

    return useQuery({
        queryKey: QueryKey.members(account),
        enabled: !!account,
        queryFn: async () => getMembers(zAccount.parse(account)),
    });
};
