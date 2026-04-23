import { useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { useFractalAccount } from "./use-fractal-account";
import { getGuildsByOwner } from "@/lib/graphql/fractals/get-guilds-by-owner";


export const useGuilds = () => {
    const currentFractal = useFractalAccount();
    return useQuery({
        queryKey: QueryKey.guilds(currentFractal),
        enabled: Boolean(currentFractal),
        queryFn: () => getGuildsByOwner(currentFractal!),
    });
};

