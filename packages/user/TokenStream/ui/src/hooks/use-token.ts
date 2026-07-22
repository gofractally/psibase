import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getToken } from "@/lib/get-token";
import QueryKey, { OptionalString } from "@/lib/query-keys";

export const useToken = (id: OptionalString) =>
    useQuery({
        queryKey: QueryKey.token(id),
        queryFn: async () => {
            return getToken(z.string().parse(id));
        },
        enabled: !!id,
    });
