import { useQuery } from "@tanstack/react-query";

import { chain } from "@/lib/chain-endpoints";

export const useTransactStats = () =>
    useQuery({
        queryKey: ["transactStats"],
        queryFn: () => chain.getTransactStats(),
        refetchInterval: 10000,
    });
