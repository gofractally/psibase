import { useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import {
    getRankedGuilds
} from "@shared/domains/fractal/lib/graphql/get-ranked-guilds";

import { useFractalAccount } from "./use-fractal-account";



export const useRankedGuilds = () => {
    const currentFractal = useFractalAccount();
    return useQuery({
        queryKey: QueryKey.guilds(currentFractal),
        enabled: Boolean(currentFractal),
        queryFn: () => getRankedGuilds(currentFractal!),
    });
};

