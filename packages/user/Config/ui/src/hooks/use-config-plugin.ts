import { CONFIG } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";

export const useConfigPlugin = (
    method: string,
    meta: { loading: string; success: string; error: string },
) =>
    usePluginMutation(
        {
            intf: "producers",
            service: CONFIG,
            method,
        },
        {
            error: meta.error,
            loading: meta.loading,
            success: meta.success,
            isStagable: true,
        },
    );
