import { useQuery } from "@tanstack/react-query";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import QueryKey from "@shared/lib/query-keys";
import { vserver } from "@shared/lib/plugins";

interface BillingConfigResponse {
    getBillingConfig: {
        feeReceiver: string;
        enabled: boolean;
    } | null;
}

export const useBillingConfig = () => {
    return useQuery({
        queryKey: QueryKey.billingConfig(),
        queryFn: async () => {
            const query = `
                query {
                    getBillingConfig {
                        feeReceiver
                        enabled
                    }
                }
            `;
            const res = await authorizedPluginGraphql<BillingConfigResponse>(
                vserver.authorized.graphql,
                query,
            );

            if (!res.getBillingConfig) {
                return { feeReceiver: null, enabled: false };
            }

            return {
                feeReceiver: res.getBillingConfig.feeReceiver ?? null,
                enabled: res.getBillingConfig.enabled,
            };
        },
    });
};
