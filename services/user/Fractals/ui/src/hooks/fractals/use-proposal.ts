import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import QueryKey, { OptionalNumber } from "@/lib/queryKeys";
import { Account, zAccount } from "@/lib/zod/Account";

export const useProposal = (
    evaluationId: OptionalNumber,
    groupNumber: OptionalNumber,
) =>
    useQuery({
        queryKey: QueryKey.proposal(evaluationId, groupNumber),
        queryFn: async () => {
            const res = await supervisor.functionCall({
                method: "getProposal",
                params: [evaluationId, groupNumber],
                service: fractalsService,
                intf: "api",
            });

            return zAccount.array().parse(res);
        },
    });

export const setCachedProposal = (
    evaluationId: number,
    groupNumber: number,
    accounts: Account[],
) => {
    queryClient.setQueryData(
        QueryKey.proposal(evaluationId, groupNumber),
        accounts,
    );
};
