import { useQuery } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import QueryKey, { OptionalNumber } from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

export const useGroupUsers = (
    evaluationId: OptionalNumber,
    groupNumber: OptionalNumber,
) =>
    useQuery({
        queryKey: QueryKey.groupUsers(evaluationId, groupNumber),
        enabled: !!(evaluationId && groupNumber),
        queryFn: async () => {
            try {
                const res = await supervisor.functionCall({
                    method: "getGroupUsers",
                    params: [evaluationId, groupNumber],
                    service: fractalsService,
                    intf: "user",
                });
                return zAccount.array().parse(res);
            } catch (error) {
                const message = "Error grouping users";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
