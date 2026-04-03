import { zAccount } from "@shared/lib/schemas/account";
import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "./use-plugin-mutation";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useConfigurePremiumMarket = () =>
    usePluginMutation<[number, number, number, string, number, number]>(
        {
            service: PREM_ACCOUNTS,
            intf: "market-admin",
            method: "configure",
        },
        {
            error: "Failed to update premium market",
            loading: "Updating premium market…",
            success: "Premium market updated",
            isStagable: true,
            onSuccess: (_params, _status) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumConfiguredMarkets(),
                });
            },
        },
    );
