import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/main";
import { getProposal } from "@lib/getProposal";
import { Account } from "@lib/zod/Account";

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
