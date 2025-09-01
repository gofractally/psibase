import { useQuery } from "@tanstack/react-query";

import { getStream } from "@/lib/getStream";
import QueryKey, { OptionalNumber } from "@/lib/queryKeys";

export const useStream = (id: OptionalNumber) =>
    useQuery({
        queryKey: QueryKey.stream(id),
        queryFn: async () => {
            return getStream(id!);
        },
        enabled: !!id,
        refetchInterval: 10000,
    });
