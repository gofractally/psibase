import { useQuery } from "@tanstack/react-query";

import { chain } from "@/lib/chainEndpoints";

export const useTransactStats = () =>
    useQuery({
        queryKey: ["transactStats"],
        queryFn: () => chain.getTransactStats(),
        refetchInterval: 10000,
    });
