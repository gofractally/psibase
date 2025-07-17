import { useQuery } from "@tanstack/react-query";

import {
    CompletedEvaluation,
    getCompletedEvaluations,
} from "@/lib/graphql/fractals/getCompletedEvaluations";
import QueryKey from "@/lib/queryKeys";

import { useCurrentFractal } from "../use-current-fractal";

export const useCompletedEvaluation = () => {
    const fractalAccount = useCurrentFractal();

    return useQuery<CompletedEvaluation[]>({
        queryKey: QueryKey.completedEvaluations(),
        queryFn: async () => {
            try {
                return getCompletedEvaluations(fractalAccount!);
            } catch (error) {
                const message = "Error getting completed evaluations";
                console.error(message, error);
                throw new Error(message);
            }
        },
        enabled: !!fractalAccount,
    });
};
