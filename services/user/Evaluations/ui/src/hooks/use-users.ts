import { useQuery } from "@tanstack/react-query";
import { getUsers } from "../lib/getUsers";

export const useUsers = (evaluationId: number | undefined) =>
    useQuery({
        queryKey: ["users", evaluationId],
        queryFn: () => getUsers(evaluationId!),
        enabled: !!evaluationId,
    });
