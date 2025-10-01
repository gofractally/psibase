import { useQuery } from "@tanstack/react-query";

import {
    CompletedEvaluation,
    getCompletedEvaluations,
} from "@/lib/graphql/fractals/getCompletedEvaluations";
import QueryKey from "@/lib/queryKeys";

import { useGuildSlug } from "../use-guild-id";

export const useCompletedEvaluation = () => {
    const guildId = useGuildSlug();

    return useQuery<CompletedEvaluation[]>({
        queryKey: QueryKey.completedEvaluations(),
        queryFn: async () => {
            try {
                return await getCompletedEvaluations(guildId!);
            } catch (error) {
                const message = "Error getting completed evaluations";
                console.error(message, error);
                throw new Error(message);
            }
        },
        enabled: !!guildId,
    });
};
