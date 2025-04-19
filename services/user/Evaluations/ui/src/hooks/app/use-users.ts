import { useQuery } from "@tanstack/react-query";
import { getUsers } from "../../lib/graphql/getUsers";
import { Account } from "@lib/zod/Account";

export const useUsers = (
    owner: Account | undefined | null,
    evaluationId: number | undefined,
    interval: number = 10000,
) =>
    useQuery({
        queryKey: ["users", owner, evaluationId],
        queryFn: () => getUsers(owner!, evaluationId!),
        enabled: !!evaluationId && !!owner,
        refetchInterval: interval,
    });
