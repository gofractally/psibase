import { useMutation, useQuery } from "@tanstack/react-query";

import { chain } from "@/lib/chain-endpoints";
import { queryKeys } from "@/lib/query-keys";

import { useChainReady } from "./use-statuses";

export const useAdminAccounts = () => {
    const chainReady = useChainReady();
    return useQuery<string[], string>({
        queryKey: queryKeys.adminAccounts,
        queryFn: async () => {
            try {
                return await chain.getAdminAccounts();
            } catch (e) {
                console.error("Failed to fetch admin accounts", e);
                throw "Failed to fetch admin accounts";
            }
        },
        enabled: chainReady,
    });
};

export const useSetAdminAccount = () =>
    useMutation<void, string, { account: string; admin: boolean }>({
        mutationKey: queryKeys.setAdminAccount,
        mutationFn: async ({ account, admin }) => {
            try {
                await chain.setAdminAccount(account, admin);
            } catch (e) {
                console.error("Failed to update admin account", e);
                throw "Failed to update admin account";
            }
        },
        onSuccess: (_data, _variables, _onMutateResult, context) => {
            context.client.invalidateQueries({
                queryKey: queryKeys.adminAccounts,
            });
        },
    });
