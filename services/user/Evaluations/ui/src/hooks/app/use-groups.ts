import { getGroups } from "@lib/graphql/getGroups";
import { useQuery } from "@tanstack/react-query";
import { Account } from "@lib/zod/Account";

export const useGroups = (
    owner: Account | undefined | null,
    evaluationId: number | undefined,
) =>
    useQuery({
        queryKey: ["groups", evaluationId],
        queryFn: () => getGroups(owner!, evaluationId!),
        enabled: !!evaluationId && !!owner,
    });
