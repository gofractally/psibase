import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";

import { type Producer, getProducers } from "@shared/lib/get-producers";

import { useConfig } from "./use-config";
import { useChainReady } from "./use-statuses";

export const useProducers = () => {
    const chainReady = useChainReady();
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
        enabled: chainReady,
    });
};

/**
 * If the node is a producer, returns the producer object that represents itself. Otherwise, returns undefined.
 */
export const useMyProducer = () => {
    const { data } = useProducers();
    const { data: config } = useConfig();

    if (!config || !data) return undefined;

    return data.find((producer) => producer.name === config.producer);
};
