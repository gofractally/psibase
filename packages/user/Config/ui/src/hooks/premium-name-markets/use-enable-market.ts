import { queryClient } from "@shared/lib/query-client";

import QueryKey from "../../lib/query-keys";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";

import { CONFIG } from "@/lib/services";

export const useEnablePremiumNameMarket = () =>
    usePluginMutation<[number]>(
        {
            service: CONFIG,
            intf: "premAccounts",
            method: "enable",
        },
        {
            error: "Failed to enable premium name market",
            loading: "Enabling new purchases…",
            success: "Premium name market purchases enabled",
            isStagable: true,
            onSuccess: (_, __) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
