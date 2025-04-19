import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/main";
import { getProposal } from "@lib/getProposal";
import { Account } from "@lib/zod/Account";

export const useProposal = (
    owner: Account | undefined,
    evaluationId: number | undefined,
    groupId: number | undefined,
) =>
    useQuery({
        queryKey: ["proposal", owner, evaluationId, groupId],
        queryFn: () => getProposal(owner!, evaluationId!, groupId!),
        enabled: !!owner && !!evaluationId && !!groupId,
        staleTime: Infinity,
    });

export const setCachedProposal = (
    evaluationId: number,
    groupId: number,
    currentUser: string,
    proposal: number[],
) => {
    queryClient.setQueryData(
        ["proposal", evaluationId, groupId, currentUser],
        proposal,
    );
};
