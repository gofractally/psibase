import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";

export const useSetFeeReceiverAccount = () =>
    usePluginMutation<[string]>(
        {
            service: CONFIG,
            method: "initBilling",
            intf: "virtualServer",
        },
        {
            error: "Failed setting fee receiver account",
            loading: "Setting fee receiver account.",
            success: "Set fee receiver account",
            isStagable: true,
            onSuccess: (feeReceiverAccount, status) => {
                if (status.type == "executed") {
                    queryClient.setQueryData(
                        [...QueryKey.virtualServer(), "billingConfig"],
                        (old: { feeReceiver: string | null; enabled: boolean } | undefined) => {
                            if (!old) return { feeReceiver: feeReceiverAccount, enabled: false };
                            return { ...old, feeReceiver: feeReceiverAccount };
                        },
                    );
                }
            },
        },
    );
