import type { ConfiguredPremiumNameMarketRow } from "@/hooks/premium-name-markets/use-configured-markets";

import { queryClient } from "@shared/lib/query-client";
import { supervisor } from "@shared/lib/supervisor";

import QueryKey from "../../lib/query-keys";

import { rowToMarketConfig } from "@/lib/name-market-config";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";

export const useDisablePremiumNameMarket = () =>
    usePluginMutation<ConfiguredPremiumNameMarketRow>(
        {
            service: CONFIG,
            intf: "nameMarket",
            method: "configureMarkets",
        },
        {
            error: "Failed to disable premium name market",
            loading: "Disabling new purchases…",
            success: "Premium name market purchases disabled",
            isStagable: true,
            customMutationFn: async (row) => {
                await supervisor.functionCall({
                    service: CONFIG,
                    intf: "nameMarket",
                    method: "configureMarkets",
                    params: [[rowToMarketConfig(row, { enabled: false })]],
                });
            },
            onSuccess: (_, __) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
