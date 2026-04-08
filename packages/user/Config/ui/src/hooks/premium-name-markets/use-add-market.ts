import { zAccount } from "@shared/lib/schemas/account";
import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "@/hooks/use-plugin-mutation";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useAddPremiumNameMarket = () =>
    usePluginMutation<[number, string, number, string, number, number]>(
        {
            service: PREM_ACCOUNTS,
            intf: "marketAdmin",
            method: "create",
        },
        {
            error: "Failed to add premium name market",
            loading: "Adding premium name market…",
            success: "Premium name market added",
            isStagable: true,
            onSuccess: (_, __) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumNameMarkets(),
                });
            },
        },
    );
