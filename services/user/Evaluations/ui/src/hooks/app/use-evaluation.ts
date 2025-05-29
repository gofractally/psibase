import { getEvaluation, Evaluation } from "@lib/graphql/getEvaluation";
import { useQuery } from "@tanstack/react-query";
import { Account } from "@lib/zod/Account";

export const useEvaluation = (
    owner: Account | undefined | null,
    id: number | undefined,
) =>
    useQuery<Evaluation>({
        queryKey: ["evaluation", owner, id],
        queryFn: async () => getEvaluation(owner!, id!),
        enabled: !!owner && !!id,
    });
