import { useQuery } from "@tanstack/react-query";

import { getScores } from "@/lib/graphql/fractals/getScores";
import QueryKey from "@/lib/queryKeys";

import { useGuildId } from "../use-guild-id";

export const useScores = () => {
    const guildId = useGuildId();
    return useQuery({
        queryKey: QueryKey.scores(guildId?.toString()),
        enabled: !!guildId,
        queryFn: async () => {
            try {
                return await getScores(guildId!);
            } catch (error) {
                const message = "Error getting scores";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
};
