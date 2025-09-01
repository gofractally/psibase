import { useQuery } from "@tanstack/react-query";

import { getNft } from "@/lib/getNft";
import QueryKey, { OptionalNumber } from "@/lib/queryKeys";

export const useNft = (id: OptionalNumber) =>
    useQuery({
        queryKey: QueryKey.nft(id),
        queryFn: async () => {
            return getNft(id!);
        },
        enabled: !!id,
    });
