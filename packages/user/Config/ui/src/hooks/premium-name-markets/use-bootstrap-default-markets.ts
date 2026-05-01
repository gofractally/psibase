import { usePluginMutation } from "@/hooks/use-plugin-mutation";
import {
    DEFAULT_MAX_PREMIUM_NAME_LENGTH_MARKET,
    DEFAULT_MIN_PREMIUM_NAME_LENGTH_MARKET,
    PREMIUM_MARKET_DEFAULT_PARAMS,
} from "@/lib/premium-name-market-defaults";
import QueryKey from "@/lib/query-keys";
import { CONFIG } from "@/lib/services";

import { queryClient } from "@shared/lib/query-client";
import { supervisor } from "@shared/lib/supervisor";

export const useBootstrapDefaultPremiumNameMarkets = () => {
    const nameLengthRangeStr = `${DEFAULT_MIN_PREMIUM_NAME_LENGTH_MARKET}-${DEFAULT_MAX_PREMIUM_NAME_LENGTH_MARKET}`;

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
                    let len = DEFAULT_MIN_PREMIUM_NAME_LENGTH_MARKET;
                    len <= DEFAULT_MAX_PREMIUM_NAME_LENGTH_MARKET;
                    len++
                ) {
                    await supervisor.functionCall({
                        service: CONFIG,
                        intf: "premAccounts",
                        method: "create",
                        params: [
                            len,
                            PREMIUM_MARKET_DEFAULT_PARAMS.initialPrice,
                            PREMIUM_MARKET_DEFAULT_PARAMS.target,
                            PREMIUM_MARKET_DEFAULT_PARAMS.floorPrice,
                            PREMIUM_MARKET_DEFAULT_PARAMS.increasePpm,
                            PREMIUM_MARKET_DEFAULT_PARAMS.decreasePpm,
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
