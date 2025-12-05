import { queryClient } from "@/queryClient";

import QueryKey from "@/lib/queryKeys";
import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";

export const useSetFeeReceiverAccount = () =>
    usePluginMutation<[string]>(
        {
            service: CONFIG,
            method: "setFeeReceiverAccount",
            intf: "virtualServer",
        },
        {
            error: "Failed setting fee receiver account",
            loading: "Setting fee receiver account.",
            success: "Set fee receiver account",
            isStagable: true,
            onSuccess: (feeReceiverAccount, status) => {
                if (status.type == "executed") {
                    queryClient.setQueryData(QueryKey.virtualServer(), feeReceiverAccount);
                }
            },
        },
    );
