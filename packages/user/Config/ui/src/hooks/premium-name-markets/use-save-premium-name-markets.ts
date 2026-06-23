import type { SystemTokenInfo } from "@shared/hooks/use-system-token";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";
import {
    type PremiumNameMarketFormRow,
    toMarketConfig,
} from "@/lib/premium-name-market-form";

import { callPluginFunction, config } from "@shared/lib/plugins";
import { queryClient } from "@shared/lib/query-client";

import QueryKey from "../../lib/query-keys";

export type SavePremiumNameMarketsInput = {
    dirtyRows: PremiumNameMarketFormRow[];
    systemToken: SystemTokenInfo;
};

const configureMarketsCall = config.premAccounts.configureMarkets;

export const useSavePremiumNameMarkets = () =>
    usePluginMutation<SavePremiumNameMarketsInput>(
        {
            service: configureMarketsCall.service,
            intf: configureMarketsCall.intf,
            method: configureMarketsCall.method,
        },
        {
            mutationKey: [
                configureMarketsCall.service,
                configureMarketsCall.intf,
                "savePremiumNameMarkets",
            ] as const,
            customMutationFn: async ({ dirtyRows, systemToken }) => {
                const configs = dirtyRows.map((row) =>
                    toMarketConfig(row, systemToken),
                );
                if (configs.length === 0) {
                    return;
                }

                await callPluginFunction(config.premAccounts.configureMarkets, [
                    configs,
                ]);
            },
            error: "Failed to update account markets",
            loading: "Updating account markets…",
            success: "Account markets updated",
            isStagable: true,
            onSuccess: () => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
