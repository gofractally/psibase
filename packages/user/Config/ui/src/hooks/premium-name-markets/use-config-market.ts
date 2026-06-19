import type { ConfiguredPremiumNameMarketRow } from "@/hooks/premium-name-markets/use-configured-markets";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";
import { rowToMarketConfig } from "@/lib/name-market-config";
import { CONFIG } from "@/lib/services";

import { queryClient } from "@shared/lib/query-client";
import { supervisor } from "@shared/lib/supervisor";

import QueryKey from "../../lib/query-keys";

export type SavePremiumNameMarketConfigInput = {
    row: ConfiguredPremiumNameMarketRow;
    target: number;
    floorPrice: string;
    increasePct: number;
    decreasePct: number;
};

export const useConfigurePremiumNameMarket = () =>
    usePluginMutation<SavePremiumNameMarketConfigInput>(
        {
            service: CONFIG,
            intf: "nameMarket",
            method: "configureMarkets",
        },
        {
            error: "Failed to update premium name market",
            loading: "Updating premium name market…",
            success: "Premium name market updated",
            isStagable: true,
            customMutationFn: async ({
                row,
                target,
                floorPrice,
                increasePct,
                decreasePct,
            }) => {
                await supervisor.functionCall({
                    service: CONFIG,
                    intf: "nameMarket",
                    method: "configureMarkets",
                    params: [
                        [
                            rowToMarketConfig(row, {
                                target,
                                floorPrice,
                                increasePct,
                                decreasePct,
                            }),
                        ],
                    ],
                });
            },
            onSuccess: (_, __) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
