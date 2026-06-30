import type { ConfiguredPremiumNameMarketRow } from "@/hooks/premium-name-markets/use-configured-markets";

import { queryClient } from "@shared/lib/query-client";
import { supervisor } from "@shared/lib/supervisor";

import QueryKey from "../../lib/query-keys";

import { rowToMarketConfig } from "@/lib/name-market-config";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";

export const useEnablePremiumNameMarket = () =>
    usePluginMutation<ConfiguredPremiumNameMarketRow>(
        {
            service: CONFIG,
            intf: "nameMarket",
            method: "configureMarkets",
        },
        {
            error: "Failed to enable premium name market",
            loading: "Enabling new purchases…",
            success: "Premium name market purchases enabled",
            isStagable: true,
            customMutationFn: async (row) => {
                await supervisor.functionCall({
                    service: CONFIG,
                    intf: "nameMarket",
                    method: "configureMarkets",
                    params: [[rowToMarketConfig(row, { enabled: true })]],
                });
            },
            onSuccess: (_, __) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
