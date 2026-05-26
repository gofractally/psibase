import { useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { useFractalAccount } from "./use-fractal-account";
import { getGuildsByFractal } from "@/lib/graphql/fractals/get-guilds-by-fractal";


export const useGuilds = () => {
    const currentFractal = useFractalAccount();
    return useQuery({
        queryKey: QueryKey.guilds(currentFractal),
        enabled: Boolean(currentFractal),
        queryFn: () => getGuildsByFractal(currentFractal!),
    });
};

