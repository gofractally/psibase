import { useQuery } from "@tanstack/react-query";

import type { BillingConfig } from "@shared/hooks/use-billing-config";
import { callPluginFunction, config } from "@shared/lib/plugins";
import QueryKey from "@shared/lib/query-keys";

export const useBillingConfig = () =>
    useQuery({
        queryKey: QueryKey.billingConfig(),
        queryFn: async (): Promise<BillingConfig> => {
            const billing = await callPluginFunction(
                config.virtualServer.getBillingConfig,
                [],
            );
            return {
                feeReceiver: billing.feeReceiver ?? null,
                enabled: billing.enabled,
            };
        },
    });
