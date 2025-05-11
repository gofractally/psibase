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
            return getEvaluation(evaluationId!);
        },
        enabled: !!evaluationId,
    });
