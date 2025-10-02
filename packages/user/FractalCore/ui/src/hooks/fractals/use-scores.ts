import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getScores } from "@/lib/graphql/fractals/getScores";
import QueryKey, { OptionalNumber } from "@/lib/queryKeys";

export const useScores = (guildId: OptionalNumber) => {
    return useQuery({
        queryKey: QueryKey.scores(guildId),
        enabled: !!guildId,
        queryFn: async () => {
            try {
                return await getScores(z.number().int().parse(guildId));
            } catch (error) {
                const message = "Error getting scores";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
};
