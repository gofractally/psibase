import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getStream } from "@/lib/getStream";
import QueryKey, { OptionalString } from "@/lib/queryKeys";

export const useStream = (id: OptionalString) =>
    useQuery({
        queryKey: QueryKey.stream(id),
        queryFn: async () => {
            return getStream(z.number().parse(Number(id)));
        },
        enabled: !!id,
        refetchInterval: 5000,
    });
