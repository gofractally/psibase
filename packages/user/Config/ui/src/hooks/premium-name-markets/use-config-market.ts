import { queryClient } from "@shared/lib/query-client";

import QueryKey from "../../lib/query-keys";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";

import { CONFIG } from "@/lib/services";

export const useConfigurePremiumNameMarket = () =>
    usePluginMutation<[number, number, number, string, number, number]>(
        {
            service: CONFIG,
            intf: "premAccounts",
            method: "configure",
        },
        {
            error: "Failed to update premium name market",
            loading: "Updating premium name market…",
            success: "Premium name market updated",
            isStagable: true,
            onSuccess: (_, __) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
