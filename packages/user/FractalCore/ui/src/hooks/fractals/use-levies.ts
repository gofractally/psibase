import { useQuery } from "@tanstack/react-query";

import { getLevies } from "@/lib/graphql/fractals/get-levies";
import QueryKey, { OptionalAccount } from "@/lib/query-keys";

import { zAccount } from "@shared/lib/schemas/account";

export const useLevies = (fractalAccount: OptionalAccount) =>
    useQuery({
        queryKey: QueryKey.levies(fractalAccount),
        enabled: !!fractalAccount,
        queryFn: async () => {
            try {
                return await getLevies(zAccount.parse(fractalAccount));
            } catch (error) {
                const message = "Error getting levies";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
