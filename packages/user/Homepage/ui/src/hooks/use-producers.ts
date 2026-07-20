import type { QueryOptions } from "@shared/hooks/types";

import { queryOptions, useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { type Producer, getProducers } from "@shared/lib/get-producers";
import { GraphQLUrlOptions } from "@shared/lib/graphql";

export const queryProducers = (opts: GraphQLUrlOptions) =>
    queryOptions({
        queryKey: QueryKey.producers(),
        queryFn: async () => {
            try {
                return await getProducers(opts);
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
    graphqlOptions?: GraphQLUrlOptions,
) => {
    const queryOptions = options ?? {};
    return useQuery({
        ...queryProducers(graphqlOptions ?? {}),
        ...queryOptions,
    });
};

export const useIsCurrentUserProducer = (options: GraphQLUrlOptions) => {
    const { data } = useProducers(undefined, options);
    const { data: currentUser } = useCurrentUser();
    if (!data || !currentUser) return false;
    return data.some((producer) => producer.name === currentUser);
};
