import { useQuery } from "@tanstack/react-query";

import { Evaluation, getEvaluation } from "@/lib/graphql/getEvaluation";
import { Account } from "@/lib/zod/Account";

export const useEvaluation = (
    owner: Account | undefined | null,
    id: number | undefined,
) =>
    useQuery<Evaluation>({
        queryKey: ["evaluation", owner, id],
        queryFn: async () => getEvaluation(owner!, id!),
        enabled: !!owner && !!id,
    });
