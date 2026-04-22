import { useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { useFractalAccount } from "./use-fractal-account";


export const useGuilds = () => {
    const currentFractal = useFractalAccount();
    return useQuery({
        queryKey: QueryKey.guilds(currentFractal),
        enabled: Boolean(currentFractal),
        queryFn: () => () => ['a'],
    });
};

