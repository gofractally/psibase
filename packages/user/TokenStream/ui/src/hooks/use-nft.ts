import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getNft } from "@/lib/get-nft";
import QueryKey, { OptionalString } from "@/lib/query-keys";

export const useNft = (id: OptionalString) =>
    useQuery({
        queryKey: QueryKey.nft(id),
        queryFn: async () => {
            return getNft(z.number().parse(Number(id)));
        },
        enabled: !!id,
    });
