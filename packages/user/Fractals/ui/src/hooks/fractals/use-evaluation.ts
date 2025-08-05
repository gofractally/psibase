import { useQuery } from "@tanstack/react-query";

import {
    Evaluation,
    getEvaluation,
} from "@/lib/graphql/evaluations/getEvaluation";
import QueryKey from "@/lib/queryKeys";

export const useEvaluation = (evaluationId: number | undefined | null) =>
    useQuery<Evaluation>({
        queryKey: QueryKey.evaluation(evaluationId),
        queryFn: async () => {
            try {
                return await getEvaluation(evaluationId!);
            } catch (error) {
                const message = "Error getting evaluation";
                console.error(message, error);
                throw new Error(message);
            }
        },
        enabled: !!evaluationId,
    });
