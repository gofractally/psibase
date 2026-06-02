import { useQuery } from "@tanstack/react-query";

import { Evaluation, getEvaluation } from "@/lib/graphql/get-evaluation";

import { type Account } from "@shared/lib/schemas/account";

export const useEvaluation = (
    owner: Account | undefined | null,
    id: number | undefined,
) =>
    useQuery<Evaluation>({
        queryKey: ["evaluation", owner, id],
        queryFn: async () => getEvaluation(owner!, id!),
        enabled: !!owner && !!id,
    });
