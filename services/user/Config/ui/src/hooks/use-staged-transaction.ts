import { useQuery } from "@tanstack/react-query";

import { getStagedTx } from "@/lib/getStagedTx";
import QueryKey from "@/lib/queryKeys";

export const useStagedTransaction = (id: number) =>
    useQuery({
        queryKey: QueryKey.stagedTransaction(id),
        queryFn: async () => {
            return getStagedTx(id);
        },
    });
