import { useQuery } from "@tanstack/react-query";

import { PeersType, chain } from "@/lib/chain-endpoints";
import { queryKeys } from "@/lib/query-keys";

import { useChainReady } from "./use-statuses";

export const usePeers = () => {
    const chainReady = useChainReady();

    return useQuery<PeersType, string>({
        queryKey: queryKeys.peers,
        queryFn: async () => {
            try {
                return await chain.getPeers();
            } catch (e) {
                console.error("Failed to fetch peers", e);
                throw "Failed to fetch peers";
            }
        },
        initialData: [],
        refetchInterval: 10000,
        enabled: chainReady,
    });
};
