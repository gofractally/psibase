import { useQuery } from "@tanstack/react-query";

import {
    CompletedEvaluation,
    getCompletedEvaluations,
} from "@/lib/graphql/fractals/getCompletedEvaluations";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

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
