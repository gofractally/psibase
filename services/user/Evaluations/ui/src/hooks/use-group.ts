import { getGroup } from "@lib/getGroup";
import { useQuery } from "@tanstack/react-query";

export const useGroup = (
    evaluationId: number | undefined,
    groupNumber: number | undefined,
) =>
    useQuery({
        queryKey: ["group", evaluationId, groupNumber],
        queryFn: () => getGroup(evaluationId!, groupNumber!),
        enabled: !!evaluationId && !!groupNumber,
    });
