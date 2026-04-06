import { zAccount } from "@shared/lib/schemas/account";
import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useConfigurePremiumNameMarket = () =>
    usePluginMutation<[number, number, number, string, number, number]>(
        {
            service: PREM_ACCOUNTS,
            intf: "market-admin",
            method: "configure",
        },
        {
            error: "Failed to update premium name market",
            loading: "Updating premium name market…",
            success: "Premium name market updated",
            isStagable: true,
            onSuccess: (_, __) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
