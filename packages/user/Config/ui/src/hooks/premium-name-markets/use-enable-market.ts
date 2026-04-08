import { zAccount } from "@shared/lib/schemas/account";
import { queryClient } from "@shared/lib/query-client";

import QueryKey from "@shared/lib/query-keys";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useEnablePremiumNameMarket = () =>
    usePluginMutation<[number]>(
        {
            service: PREM_ACCOUNTS,
            intf: "marketAdmin",
            method: "enable",
        },
        {
            error: "Failed to enable premium name market",
            loading: "Enabling new purchases…",
            success: "Premium name market purchases enabled",
            isStagable: true,
            onSuccess: (_, __) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
