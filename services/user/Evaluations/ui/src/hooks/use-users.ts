import { useQuery } from "@tanstack/react-query";
import { getUsers } from "../lib/getUsers";

export const useUsers = (
    evaluationId: number | undefined,
    interval: number = 10000,
) =>
    useQuery({
        queryKey: ["users", evaluationId],
        queryFn: () => getUsers(evaluationId!),
        enabled: !!evaluationId,
        refetchInterval: interval,
    });
