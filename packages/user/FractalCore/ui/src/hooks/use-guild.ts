import { useQuery } from "@tanstack/react-query";

import { getGuildBySlug } from "@/lib/graphql/fractals/getGuildBySlug";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

import { useFractalAccount } from "./fractals/use-fractal-account";
import { useGuildSlug } from "./use-guild-id";

export const useGuild = (
    optionalFractal?: OptionalAccount,
    optionalSlug?: OptionalAccount,
) => {
    const guildSlug = useGuildSlug();
    const currentFractal = useFractalAccount();
    const fractal = optionalFractal || currentFractal;
    const slug = optionalSlug || guildSlug;

    return useQuery({
        queryKey: QueryKey.guildBySlug(fractal, slug),
        queryFn: async () => {
            return getGuildBySlug(fractal!, slug!);
        },
        staleTime: 10000,
        enabled: !!(fractal && slug),
    });
};
