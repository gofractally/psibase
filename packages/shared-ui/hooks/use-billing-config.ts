import { useQuery } from "@tanstack/react-query";

import { graphql, GraphQLUrlOptions } from "@shared/lib/graphql";
import QueryKey from "@shared/lib/query-keys";

interface BillingConfigResponse {
    getBillingConfig: {
        feeReceiver: string;
        enabled: boolean;
    } | null;
}

export const useBillingConfig = (options: GraphQLUrlOptions = {baseUrlIncludesSibling: true}) => {
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
            const res = await graphql<BillingConfigResponse>(
                query,
                {service: "virtual-server", ...options},
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
