import { useQuery } from "@tanstack/react-query";

import { getScores } from "@/lib/graphql/fractals/getScores";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { useCurrentFractal } from "../use-current-fractal";

export const useScores = (account?: OptionalAccount) => {
    const currentFractal = useCurrentFractal();
    return useQuery({
        queryKey: QueryKey.scores(currentFractal, account),
        enabled: !!currentFractal,
        queryFn: async () => getScores(zAccount.parse(currentFractal)),
    });
};
