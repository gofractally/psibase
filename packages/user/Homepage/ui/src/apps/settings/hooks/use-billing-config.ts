import { useQuery } from "@tanstack/react-query";

import { graphql } from "@/lib/graphql";
import { zAccount } from "@/lib/zod/Account";

interface BillingConfigResponse {
    getBillingConfig: {
        feeReceiver: string;
        enabled: boolean;
    } | null;
}

export const useBillingConfig = () => {
    return useQuery({
        queryKey: ["billingConfig"],
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
                zAccount.parse("virtual-server"),
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
