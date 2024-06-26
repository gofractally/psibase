import { getJson } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";
import { Peer } from "../peers/interfaces";
import { z } from "zod";
import { queryKeys } from "@/lib/queryKeys";

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
                return Peers.parse(
                    await getJson<Peer[]>("/native/admin/peers")
                );
            } catch (e) {
                console.error("Failed to fetch peers", e);
                throw "Failed to fetch peers";
            }
        },
        refetchInterval: 10000,
    });
