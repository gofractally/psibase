import { useQuery } from "@tanstack/react-query";

import { chain } from "@/lib/chain-endpoints";

import { useChainReady } from "./use-statuses";

export const useTransactStats = () => {
    const chainReady = useChainReady();

    return useQuery({
        queryKey: ["transactStats"],
        queryFn: () => chain.getTransactStats(),
        refetchInterval: 10000,
        enabled: chainReady,
    });
};
