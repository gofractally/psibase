import { usePluginMutation } from "@/hooks/use-plugin-mutation";
import {
    MAX_PREMIUM_NAME_LENGTH_MARKET,
    MIN_PREMIUM_NAME_LENGTH_MARKET,
    PREMIUM_MARKET_DEFAULTS,
} from "@/lib/premium-name-market-defaults";
import QueryKey from "@/lib/query-keys";
import { CONFIG } from "@/lib/services";

import { queryClient } from "@shared/lib/query-client";
import { supervisor } from "@shared/lib/supervisor";

export const useBootstrapDefaultPremiumNameMarkets = () => {
    const nameLengthRangeStr = `${MIN_PREMIUM_NAME_LENGTH_MARKET}-${MAX_PREMIUM_NAME_LENGTH_MARKET}`;

    return usePluginMutation<void>(
        {
            service: CONFIG,
            intf: "premAccounts",
            method: "create",
        },
        {
            mutationKey: [
                CONFIG,
                "premAccounts",
                "bootstrapDefaultPremiumNameMarkets",
            ] as const,
            customMutationFn: async () => {
                for (
                    let len = MIN_PREMIUM_NAME_LENGTH_MARKET;
                    len <= MAX_PREMIUM_NAME_LENGTH_MARKET;
                    len++
                ) {
                    await supervisor.functionCall({
                        service: CONFIG,
                        intf: "premAccounts",
                        method: "create",
                        params: [
                            len,
                            PREMIUM_MARKET_DEFAULTS.initialPrice,
                            PREMIUM_MARKET_DEFAULTS.target,
                            PREMIUM_MARKET_DEFAULTS.floorPrice,
                            PREMIUM_MARKET_DEFAULTS.increasePpm,
                            PREMIUM_MARKET_DEFAULTS.decreasePpm,
                        ],
                    });
                }
            },
            error: "Failed to configure default premium name markets",
            loading: `Configuring premium name markets ${nameLengthRangeStr}…`,
            success: `Premium name markets ${nameLengthRangeStr} updated`,
            isStagable: true,
            onSuccess: () => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
};
