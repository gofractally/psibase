import { useQuery } from "@tanstack/react-query";

import { getFractals } from "@/lib/graphql/fractals/getFractals";
import QueryKey from "@/lib/queryKeys";

export const useFractals = () =>
    useQuery({
        queryKey: QueryKey.fractals(),
        queryFn: async () => {
            return getFractals();
        },
    });
