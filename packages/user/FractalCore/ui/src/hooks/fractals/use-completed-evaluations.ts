import { useQuery } from "@tanstack/react-query";

import {
    CompletedEvaluation,
    getCompletedEvaluations,
} from "@/lib/graphql/fractals/get-completed-evaluations";
import QueryKey, { OptionalAccount } from "@/lib/query-keys";

export const useCompletedEvaluation = (guildAccount: OptionalAccount) => {
    return useQuery<CompletedEvaluation[]>({
        queryKey: QueryKey.completedEvaluations(),
        queryFn: async () => {
            try {
                return await getCompletedEvaluations(guildAccount!);
            } catch (error) {
                const message = "Error getting completed evaluations";
                console.error(message, error);
                throw new Error(message);
            }
        },
        enabled: !!guildAccount,
    });
};
