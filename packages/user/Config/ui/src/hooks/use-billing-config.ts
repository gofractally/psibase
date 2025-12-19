import { useQuery } from "@tanstack/react-query";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

interface BillingConfigResponse {
    getBillingConfig: {
        fee_receiver: string;
        enabled: boolean;
    } | null;
}

export const useBillingConfig = () => {
    return useQuery({
        queryKey: [...QueryKey.virtualServer(), "billingConfig"],
        queryFn: async () => {
            const query = `
                query {
                    getBillingConfig {
                        fee_receiver
                        enabled
                    }
                }
            `;
            const res = await graphql<BillingConfigResponse>(
                query,
                siblingUrl(null, "virtual-server", "/graphql"),
            );
            
            if (!res.getBillingConfig) {
                return {
                    feeReceiver: null,
                    enabled: false,
                };
            }
            
            return {
                feeReceiver: res.getBillingConfig.fee_receiver || null,
                enabled: res.getBillingConfig.enabled,
            };
        },
    });
};

