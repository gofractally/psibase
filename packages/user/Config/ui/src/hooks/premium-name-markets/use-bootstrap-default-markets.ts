import { queryClient } from "@shared/lib/query-client";
import {
    MAX_PREMIUM_NAME_LENGTH,
    MIN_PREMIUM_NAME_LENGTH,
    zAccount,
} from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";
import { PREMIUM_MARKET_DEFAULTS } from "@/lib/premium-name-market-defaults";
import QueryKey from "@/lib/query-keys";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useBootstrapDefaultPremiumNameMarkets = () => {
    const nameLengthRangeStr = `${MIN_PREMIUM_NAME_LENGTH}-${MAX_PREMIUM_NAME_LENGTH}`;

    return usePluginMutation<void>(
        {
            service: PREM_ACCOUNTS,
            intf: "marketAdmin",
            method: "create",
        },
        {
            mutationKey: [
                PREM_ACCOUNTS,
                "marketAdmin",
                "bootstrapDefaultPremiumNameMarkets",
            ] as const,
            customMutationFn: async () => {
                for (
                    let len = MIN_PREMIUM_NAME_LENGTH;
                    len <= MAX_PREMIUM_NAME_LENGTH;
                    len++
                ) {
                    await supervisor.functionCall({
                        service: PREM_ACCOUNTS,
                        intf: "marketAdmin",
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
