import { useQuery } from "@tanstack/react-query";

import { fractalsService } from "@/lib/constants";
import { getUsersAndGroups } from "@/lib/graphql/evaluations/getUsersAndGroups";
import QueryKey from "@/lib/queryKeys";

export const useUsersAndGroups = (
    interval = 10000,
    evaluationId: number | undefined | null,
) => {
    return useQuery({
        queryKey: QueryKey.usersAndGroups(evaluationId),
        enabled: !!evaluationId,
        refetchInterval: interval,
        queryFn: async () => {
            const res = await getUsersAndGroups(fractalsService, evaluationId!);

            console.log(res, "is back from the zodded promise?");
            return res;
        },
    });
};
