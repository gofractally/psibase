import { useQuery } from "@tanstack/react-query";

import { type Producer, getProducers } from "@/lib/graphql/getProducers";
import { queryKeys } from "@/lib/queryKeys";

import { useConfig } from "./useConfig";

export const useProducers = () => {
    return useQuery<Producer[]>({
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
    const { data } = useProducers();
    const { data: config } = useConfig();

    const producers = data?.map((producer) => producer.name);

    if (!config || !producers) return undefined;

    return producers.includes(config.producer);
};

export const useMyProducer = () => {
    const { data } = useProducers();
    const { data: config } = useConfig();

    if (!config || !data) return undefined;

    return data.find((producer) => producer.name === config.producer);
};
