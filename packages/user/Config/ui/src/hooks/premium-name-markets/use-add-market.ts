import { queryClient } from "@shared/lib/query-client";

import QueryKey from "../../lib/query-keys";

import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";

export const useAddPremiumNameMarket = () =>
    usePluginMutation<[number, string, number, string, number, number]>(
        {
            service: CONFIG,
            intf: "premAccounts",
            method: "create",
        },
        {
            error: "Failed to add premium name market",
            loading: "Adding premium name market…",
            success: "Premium name market added",
            isStagable: true,
            onSuccess: (_, __) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
