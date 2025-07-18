import { useQuery } from "@tanstack/react-query";

import { getEvaluationResults } from "@/lib/graphql/fractals/getEvaluationResults.ts";
import QueryKey, { OptionalNumber } from "@/lib/queryKeys";

export const useEvaluationResults = (evaluationId: OptionalNumber) =>
    useQuery({
        queryKey: QueryKey.evaluationResults(evaluationId),
        enabled: !!evaluationId,
        queryFn: async () => {
            try {
                return await getEvaluationResults(evaluationId!);
            } catch (error) {
                const message = "Error getting evaluation results";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
