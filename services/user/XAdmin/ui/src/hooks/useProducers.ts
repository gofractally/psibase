import { useQuery } from "@tanstack/react-query";

import { getProducers } from "@/lib/graphql/getProducers";
import { queryKeys } from "@/lib/queryKeys";

import { useConfig } from "./useConfig";

export const useProducers = () => {
    return useQuery<string[]>({
        queryKey: queryKeys.producers,
        queryFn: async () => {
            try {
                return await getProducers();
            } catch (error) {
                const message = "Error getting producers";
                console.error(message, error);
                throw new Error(message);
            }
        },
    });
};

export const useIsProducer = () => {
    const { data: producers } = useProducers();
    const { data: config } = useConfig();

    if (!config || !producers) return undefined;

    return producers.includes(config.producer);
};
