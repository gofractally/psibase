import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { fractalsService } from "@/lib/constants";
import QueryKey, { OptionalNumber } from "@/lib/queryKeys";
import { Account, zAccount } from "@/lib/zod/Account";

const Params = z.object({
    evaluationId: z.number(),
    groupNumber: z.number(),
});

export const useGroupUsers = (
    evaluationId: OptionalNumber,
    groupNumber: OptionalNumber,
) => {
    return useQuery<Account[], Error, z.infer<typeof Params>>({
        queryKey: QueryKey.groupUsers(evaluationId, groupNumber),
        enabled: !!(evaluationId && groupNumber),
        queryFn: async () => {
            const res = await supervisor.functionCall({
                method: "getGroupUsers",
                params: [evaluationId, groupNumber],
                service: fractalsService,
                intf: "api",
            });

            return zAccount.array().parse(res);
        },
    });
};
