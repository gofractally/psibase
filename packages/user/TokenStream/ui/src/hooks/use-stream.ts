import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getStream } from "@/lib/get-stream";
import QueryKey, { OptionalString } from "@/lib/query-keys";

export const useStream = (id: OptionalString) =>
    useQuery({
        queryKey: QueryKey.stream(id),
        queryFn: async () => {
            return getStream(z.number().parse(Number(id)));
        },
        enabled: !!id,
        refetchInterval: 2000,
    });
