
import { queryClient } from "@shared/lib/query-client";

import QueryKey from "../../lib/query-keys";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";
import { CONFIG } from "@/lib/services";

export const useDisablePremiumNameMarket = () =>
    usePluginMutation<[number]>(
        {
            service: CONFIG,
            intf: "premAccounts",
            method: "disable",
        },
        {
            error: "Failed to disable premium name market",
            loading: "Disabling new purchases…",
            success: "Premium name market purchases disabled",
            isStagable: true,
            onSuccess: (_, __) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
