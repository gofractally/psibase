import { useMutation, useQuery } from "@tanstack/react-query";

import { chain } from "@/lib/chain-endpoints";
import { queryKeys } from "@/lib/query-keys";

export const usePeerUsers = () =>
    useQuery<string[], string>({
        queryKey: queryKeys.peerUsers,
        queryFn: async () => {
            try {
                return await chain.getPeerUsers();
            } catch (e) {
                console.error("Failed to fetch peer users", e);
                throw "Failed to fetch peer users";
            }
        },
        initialData: [],
        refetchInterval: 10000,
    });

export const useSetPeerUser = () =>
    useMutation<void, string, { account: string; accept: boolean }>({
        mutationKey: queryKeys.setPeerUser,
        mutationFn: async ({ account, accept }) => {
            try {
                await chain.setPeerUser(account, accept);
            } catch (e) {
                console.error("Failed to update peer user", e);
                throw "Failed to update peer user";
            }
        },
        onSuccess: (_data, _variables, _onMutateResult, context) => {
            context.client.invalidateQueries({ queryKey: queryKeys.peerUsers });
        },
    });
