import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { PeerType, PeersType, chain } from "@/lib/chainEndpoints";
import { queryKeys } from "@/lib/queryKeys";
import { recursiveFetch } from "@/lib/recursiveFetch";

export const connectParam = z.object({
    url: z.string(),
});

interface PeersUpdate {
    newPeer: PeerType;
    peers: PeerType[];
}

const connectToPeer = async (
    data: z.infer<typeof connectParam>,
    preExistingPeers: PeersType,
): Promise<PeersUpdate> => {
    await chain.connect(data);
    return recursiveFetch(async () => {
        const newPeers = await chain.getPeers();
        if (newPeers.length !== preExistingPeers.length) {
            const newPeer = newPeers.find(
                (peer) =>
                    !preExistingPeers.some((p) => p.endpoint == peer.endpoint),
            );
            if (!newPeer) return false;
            return {
                newPeer,
                peers: newPeers,
            };
        } else {
            return false;
        }
    });
};

export const useConnect = () =>
    useMutation<PeersUpdate, Error, z.infer<typeof connectParam>>({
        mutationKey: queryKeys.connect,
        mutationFn: async (param) => {
            try {
                const beforePeers = await chain.getPeers();
                const connectedPeer = await connectToPeer(param, beforePeers);
                await chain.addPeer(param.url);
                return connectedPeer;
            } catch {
                throw new Error("Failed connecting to node");
            }
        },
    });
