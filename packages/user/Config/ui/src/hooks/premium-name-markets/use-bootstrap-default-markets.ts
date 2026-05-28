import { usePluginMutation } from "@/hooks/use-plugin-mutation";
import { PREMIUM_MARKET_DEFAULT_PARAMS } from "@/lib/premium-name-market-defaults";
import QueryKey from "@/lib/query-keys";
import { CONFIG } from "@/lib/services";

import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
} from "@shared/constants";
import { queryClient } from "@shared/lib/query-client";
import { supervisor } from "@shared/lib/supervisor";

export const useBootstrapDefaultPremiumNameMarkets = () => {
    const nameLengthRangeStr = `${MIN_ACCOUNT_NAME_LENGTH}-${MAX_ACCOUNT_NAME_LENGTH}`;

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
                    let len = MIN_ACCOUNT_NAME_LENGTH;
                    len <= MAX_ACCOUNT_NAME_LENGTH;
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
