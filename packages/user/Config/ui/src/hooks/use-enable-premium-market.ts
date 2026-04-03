import { zAccount } from "@shared/lib/schemas/account";
import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "./use-plugin-mutation";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useEnablePremiumMarket = () =>
    usePluginMutation<[number]>(
        {
            service: PREM_ACCOUNTS,
            intf: "market-admin",
            method: "enable",
        },
        {
            error: "Failed to enable premium market",
            loading: "Enabling new purchases…",
            success: "Premium market purchases enabled",
            isStagable: true,
            onSuccess: (_params, _status) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumConfiguredMarkets(),
                });
            },
        },
    );
