import { useQuery } from "@tanstack/react-query";

import { getProposal } from "@/lib/getProposal";

import { queryClient } from "@shared/lib/queryClient";
import { type Account } from "@shared/lib/schemas/account";

const genQueryKey = (owner: Account, evaluationId: number, groupId: number) => [
    "proposal",
    owner,
    evaluationId,
    groupId,
];

export const useProposal = (
    owner: Account | undefined,
    evaluationId: number | undefined,
    groupId: number | undefined,
) =>
    useQuery({
        queryKey: genQueryKey(owner!, evaluationId!, groupId!),
        queryFn: () => getProposal(owner!, evaluationId!, groupId!),
        enabled: !!owner && !!evaluationId && !!groupId,
        staleTime: Infinity,
    });

export const setCachedProposal = (
    owner: Account,
    evaluationId: number,
    groupId: number,
    proposal: number[],
) => {
    queryClient.setQueryData(
        genQueryKey(owner, evaluationId, groupId),
        proposal,
    );
};
