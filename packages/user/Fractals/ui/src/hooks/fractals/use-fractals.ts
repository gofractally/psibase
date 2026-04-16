import { useQuery } from "@tanstack/react-query";

import { getFractals } from "@/lib/graphql/get-fractals";
import QueryKey from "@/lib/query-keys";

export const useFractals = () =>
    useQuery({
        queryKey: QueryKey.fractals(),
        queryFn: async () => {
            try {
                return await getFractals();
            } catch (error) {
                const message = "Error getting fractals";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
