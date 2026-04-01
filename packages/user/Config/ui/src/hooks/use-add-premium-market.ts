import { zAccount } from "@/lib/zod/Account";
import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "./use-plugin-mutation";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useAddPremiumMarket = () =>
    usePluginMutation<[number]>(
        {
            service: PREM_ACCOUNTS,
            intf: "admin",
            method: "addMarket",
        },
        {
            error: "Failed to add premium market",
            loading: "Adding premium market…",
            success: "Premium market added",
            isStagable: true,
            onSuccess: (_params, _status) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumMarketsStatus(),
                });
            },
        },
    );
