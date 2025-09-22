import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getNft } from "@/lib/getNft";
import QueryKey, { OptionalString } from "@/lib/queryKeys";

export const useNft = (id: OptionalString) =>
    useQuery({
        queryKey: QueryKey.nft(id),
        queryFn: async () => {
            return getNft(z.number().parse(Number(id)));
        },
        enabled: !!id,
    });
