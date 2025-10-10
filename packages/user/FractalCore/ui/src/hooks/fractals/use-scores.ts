import { useQuery } from "@tanstack/react-query";

import { getScores } from "@/lib/graphql/fractals/getScores";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

export const useScores = (guildAccount: OptionalAccount) => {
    return useQuery({
        queryKey: QueryKey.scores(guildAccount),
        enabled: !!guildAccount,
        queryFn: async () => {
            try {
                return await getScores(zAccount.parse(guildAccount));
            } catch (error) {
                const message = "Error getting scores";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
};
