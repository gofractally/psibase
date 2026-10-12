import { useQuery } from "@tanstack/react-query";

import { hostingAppCall } from "@shared/lib/plugins/host-app";
import { callPluginFunction } from "@shared/lib/plugins/lib/call-plugin-function";
import { type BillingConfig as PluginBillingConfig } from "@shared/lib/plugins/virtual-server";
import QueryKey from "@shared/lib/query-keys";

export type BillingConfig = {
    feeReceiver: string | null;
    enabled: boolean;
};

export const useBillingConfig = () =>
    useQuery({
        queryKey: QueryKey.billingConfig(),
        queryFn: async (): Promise<BillingConfig> => {
            const billing = await callPluginFunction(
                hostingAppCall<[], PluginBillingConfig>(
                    "virtual-server",
                    "getBillingConfig",
                ),
                [],
            );
            return {
                feeReceiver: billing.feeReceiver ?? null,
                enabled: billing.enabled,
            };
        },
    });
