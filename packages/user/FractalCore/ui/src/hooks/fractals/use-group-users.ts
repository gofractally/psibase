import { useQuery } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import QueryKey, { OptionalAccount, OptionalNumber } from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

import { useFractalAccount } from "./use-fractal-account";

export const useGroupUsers = (
    guildSlug: OptionalAccount,
    groupNumber: OptionalNumber,
) => {
    const fractal = useFractalAccount();
    return useQuery({
        queryKey: QueryKey.groupUsers(guildSlug, groupNumber),
        enabled: !!(guildSlug && groupNumber),
        queryFn: async () => {
            try {
                const res = await supervisor.functionCall({
                    method: "getGroupUsers",
                    params: [guildSlug, groupNumber],
                    service: fractal,
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
};
