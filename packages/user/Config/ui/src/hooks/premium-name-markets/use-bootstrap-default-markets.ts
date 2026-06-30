import { usePluginMutation } from "@/hooks/use-plugin-mutation";
import { defaultMarketConfigForLength } from "@/lib/name-market-config";
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
            intf: "nameMarket",
            method: "configureMarkets",
        },
        {
            mutationKey: [
                CONFIG,
                "nameMarket",
                "bootstrapDefaultPremiumNameMarkets",
            ] as const,
            customMutationFn: async () => {
                const configs = [];
                for (
                    let len = MIN_ACCOUNT_NAME_LENGTH;
                    len <= MAX_ACCOUNT_NAME_LENGTH;
                    len++
                ) {
                    configs.push(defaultMarketConfigForLength(len));
                }
                await supervisor.functionCall({
                    service: CONFIG,
                    intf: "nameMarket",
                    method: "configureMarkets",
                    params: [configs],
                });
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
