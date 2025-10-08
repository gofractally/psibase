import { PRODUCERS } from "@/lib/services";

import { usePluginMutation } from "./use-plugin-mutation";

export const useProducersPlugin = (
    method: string,
    meta: {
        loading: string;
        success: string;
        error: string;
        isStagable?: boolean;
    },
) =>
    usePluginMutation(
        {
            intf: "api",
            service: PRODUCERS,
            method,
        },
        {
            error: meta.error,
            loading: meta.loading,
            success: meta.success,
            isStagable: meta.isStagable ?? true,
        },
    );
