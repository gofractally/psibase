import { useQuery } from "@tanstack/react-query";

import { getEvaluationResults } from "@/lib/graphql/fractals/getEvaluationResults.ts";
import QueryKey, { OptionalNumber } from "@/lib/queryKeys";

export const useEvaluationResults = (evaluationId: OptionalNumber) =>
    useQuery({
        queryKey: QueryKey.evaluationResults(evaluationId),
        enabled: !!evaluationId,
        queryFn: async () => {
            return getEvaluationResults(evaluationId!);
        },
    });
