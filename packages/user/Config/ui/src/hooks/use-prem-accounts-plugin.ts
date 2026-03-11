import { PREM_ACCOUNTS } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";

export const usePremAccountsPlugin = (
    method: string,
    meta: {
        loading: string;
        success: string;
        error: string;
        isStagable?: boolean;
    },
) =>
    usePluginMutation<[number, boolean]>(
        {
            intf: "api",
            service: PREM_ACCOUNTS,
            method,
        },
        {
            error: meta.error,
            loading: meta.loading,
            success: meta.success,
            isStagable: meta.isStagable ?? false,
        },
    );

