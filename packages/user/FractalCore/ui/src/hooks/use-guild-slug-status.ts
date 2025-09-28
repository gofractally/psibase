import { useQuery } from "@tanstack/react-query";

import { getGuildBySlug } from "@/lib/graphql/fractals/getGuildBySlug";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

export const useGuildBySlug = (
    fractal: OptionalAccount,
    slug: OptionalAccount,
) =>
    useQuery({
        queryKey: QueryKey.fractalBySlug(fractal, slug),
        queryFn: async () => {
            return getGuildBySlug(fractal!, slug!);
        },
        staleTime: 10000,
        enabled: !!(fractal && slug),
    });
