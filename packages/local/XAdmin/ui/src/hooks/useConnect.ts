import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { PeerType, chain } from "@/lib/chainEndpoints";
import { queryKeys } from "@/lib/queryKeys";

export const connectParam = z.object({
    url: z.string(),
});

export const useConnect = () =>
    useMutation<PeerType, Error, z.infer<typeof connectParam>>({
        mutationKey: queryKeys.connect,
        mutationFn: async (param) => {
            try {
                const connectedPeer = await chain.connect(param);
                await chain.addPeer(param.url);
                return connectedPeer;
            } catch {
                throw new Error("Failed connecting to node");
            }
        },
    });
