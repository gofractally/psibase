import { useQuery } from "@tanstack/react-query";

import { getScores } from "@/lib/graphql/fractals/getScores";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { useCurrentFractal } from "../use-current-fractal";

export const useScores = () => {
    const currentFractal = useCurrentFractal();
    return useQuery({
        queryKey: QueryKey.scores(currentFractal),
        enabled: !!currentFractal,
        queryFn: async () => {
            try {
                return getScores(zAccount.parse(currentFractal));
            } catch (error) {
                const message = "Error getting scores";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
};
