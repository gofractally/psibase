import { useQuery } from "@tanstack/react-query";

import { getStagedTx } from "@/lib/get-staged-tx";
import QueryKey from "@/lib/query-keys";

export const useStagedTransaction = (id: number) =>
    useQuery({
        queryKey: QueryKey.stagedTransaction(id),
        queryFn: async () => {
            return getStagedTx(id);
        },
    });
