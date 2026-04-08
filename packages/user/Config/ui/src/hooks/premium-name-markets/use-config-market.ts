import { zAccount } from "@shared/lib/schemas/account";
import { queryClient } from "@shared/lib/query-client";

import QueryKey from "../../lib/query-keys";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useConfigurePremiumNameMarket = () =>
    usePluginMutation<[number, number, number, string, number, number]>(
        {
            service: PREM_ACCOUNTS,
            intf: "marketAdmin",
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
