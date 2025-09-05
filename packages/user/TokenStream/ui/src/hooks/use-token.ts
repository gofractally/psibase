import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getToken } from "@/lib/getToken";
import QueryKey, { OptionalString } from "@/lib/queryKeys";

export const useToken = (id: OptionalString) =>
    useQuery({
        queryKey: QueryKey.token(id),
        queryFn: async () => {
            return getToken(z.string().parse(id));
        },
        enabled: !!id,
    });
