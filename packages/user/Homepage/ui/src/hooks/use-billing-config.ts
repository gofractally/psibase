import { useQuery } from "@tanstack/react-query";

import type { BillingConfig } from "@shared/hooks/use-billing-config";
import { callPluginFunction, homepage } from "@shared/lib/plugins";
import QueryKey from "@shared/lib/query-keys";

export const useBillingConfig = () =>
    useQuery({
        queryKey: QueryKey.billingConfig(),
        queryFn: async (): Promise<BillingConfig> => {
            const config = await callPluginFunction(
                homepage.vserver.getBillingConfig,
                [],
            );
            return {
                feeReceiver: config.feeReceiver ?? null,
                enabled: config.enabled,
            };
        },
    });
