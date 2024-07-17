import { useQuery } from "@tanstack/react-query";
import { Peer } from "../peers/interfaces";
import { z } from "zod";
import { queryKeys } from "@/lib/queryKeys";
import { chain } from "@/lib/chainEndpoints";

const Peers = z
    .object({
        id: z.number(),
        endpoint: z.string(),
        url: z.string().optional(),
    })
    .array();

export const usePeers = () =>
    useQuery<Peer[], string>({
        queryKey: queryKeys.peers,
        queryFn: async () => {
            try {
                return await chain.getPeers();
            } catch (e) {
                console.error("Failed to fetch peers", e);
                throw "Failed to fetch peers";
            }
        },
        refetchInterval: 10000,
    });
