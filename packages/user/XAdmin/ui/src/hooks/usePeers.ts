import { useQuery } from "@tanstack/react-query";

import { PeersType, chain } from "@/lib/chainEndpoints";
import { queryKeys } from "@/lib/queryKeys";

export const usePeers = () =>
    useQuery<PeersType, string>({
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
    });
