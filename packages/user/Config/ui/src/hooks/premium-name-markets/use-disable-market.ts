import { zAccount } from "@shared/lib/schemas/account";
import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useDisablePremiumNameMarket = () =>
    usePluginMutation<[number]>(
        {
            service: PREM_ACCOUNTS,
            intf: "market-admin",
            method: "disable",
        },
        {
            error: "Failed to disable premium name market",
            loading: "Disabling new purchases…",
            success: "Premium name market purchases disabled",
            isStagable: true,
            onSuccess: (_, __) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
