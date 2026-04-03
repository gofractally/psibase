import { zAccount } from "@shared/lib/schemas/account";
import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "./use-plugin-mutation";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useDisablePremiumMarket = () =>
    usePluginMutation<[number]>(
        {
            service: PREM_ACCOUNTS,
            intf: "market-admin",
            method: "disable",
        },
        {
            error: "Failed to disable premium market",
            loading: "Disabling new purchases…",
            success: "Premium market purchases disabled",
            isStagable: true,
            onSuccess: (_params, _status) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumConfiguredMarkets(),
                });
            },
        },
    );
