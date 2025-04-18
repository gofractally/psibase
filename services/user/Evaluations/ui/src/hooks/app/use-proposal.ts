import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/main";
import { getProposal } from "@lib/getProposal";

export const useProposal = (
    evaluationId: number | undefined,
    groupId: number | undefined,
    currentUser: string | undefined | null,
) =>
    useQuery({
        queryKey: ["proposal", evaluationId, groupId, currentUser],
        queryFn: () => getProposal(evaluationId!, groupId!, currentUser!),
        enabled: !!evaluationId && !!groupId && !!currentUser,
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
