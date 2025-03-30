import { getGroups } from "@lib/getGroups";
import { useQuery } from "@tanstack/react-query";

export const useGroups = (evaluationId: number | undefined) =>
    useQuery({
        queryKey: ["groups", evaluationId],
        queryFn: () => getGroups(evaluationId!),
        enabled: !!evaluationId,
    });
