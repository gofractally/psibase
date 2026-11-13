import { useQuery } from "@tanstack/react-query";

import { getExiles } from "@/lib/graphql/fractals/get-exiles";
import QueryKey, { OptionalAccount } from "@/lib/query-keys";

import { zAccount } from "@shared/lib/schemas/account";

export const useExiles = (fractalAccount: OptionalAccount) =>
    useQuery({
        queryKey: QueryKey.exiles(fractalAccount),
        enabled: !!fractalAccount,
        queryFn: async () => {
            try {
                return await getExiles(zAccount.parse(fractalAccount));
            } catch (error) {
                const message = "Error getting exiles";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
