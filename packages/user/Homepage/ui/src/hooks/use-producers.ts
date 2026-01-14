import type { QueryOptions } from "@shared/hooks/types";

import { queryOptions, useQuery } from "@tanstack/react-query";

import { type Producer, getProducers } from "@/lib/get-producers";
import QueryKey from "@/lib/queryKeys";

import { useCurrentUser } from "@shared/hooks/use-current-user";

export const queryProducers = queryOptions({
    queryKey: QueryKey.producers(),
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

export const useProducers = (
    options?: QueryOptions<
        Producer[],
        Error,
        Producer[],
        ReturnType<typeof QueryKey.producers>
    >,
) => {
    const queryOptions = options ?? {};
    return useQuery({
        ...queryProducers,
        ...queryOptions,
    });
};

export const useIsCurrentUserProducer = () => {
    const { data } = useProducers();
    const { data: currentUser } = useCurrentUser();
    if (!data || !currentUser) return false;
    return data.some((producer) => producer.name === currentUser);
};
