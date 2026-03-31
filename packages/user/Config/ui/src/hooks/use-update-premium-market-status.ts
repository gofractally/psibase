import { zAccount } from "@/lib/zod/Account";
import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";

import { usePluginMutation } from "./use-plugin-mutation";

const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

export const useUpdatePremiumMarketStatus = () =>
    usePluginMutation<[number, boolean]>(
        {
            service: PREM_ACCOUNTS,
            intf: "admin",
            method: "updateMarketStatus",
        },
        {
            error: "Failed to update premium market",
            loading: "Updating premium market…",
            success: "Premium market updated",
            isStagable: true,
            onSuccess: (_params, _status) => {
                void queryClient.invalidateQueries({
                    queryKey: QueryKey.premiumMarketsStatus(),
                });
            },
        },
    );
