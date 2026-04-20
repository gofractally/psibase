import { useQuery } from "@tanstack/react-query";

import { getMembers } from "@/lib/graphql/fractals/get-members";
import QueryKey, { OptionalAccount } from "@/lib/query-keys";

import { zAccount } from "@shared/lib/schemas/account";

import { useFractalAccount } from "./use-fractal-account";

export const useMembers = (accountParam?: OptionalAccount) => {
    const currentFractal = useFractalAccount();
    const account = accountParam || currentFractal;

    return useQuery({
        queryKey: QueryKey.members(account),
        enabled: !!account,
        queryFn: async () => {
            try {
                return await getMembers(zAccount.parse(account));
            } catch (error) {
                const message = "Error getting members";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
};
