import { useQuery } from "@tanstack/react-query";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { type PluginCall } from "@shared/lib/plugins/lib/call-plugin-function";
import QueryKey from "@shared/lib/query-keys";

export type GraphqlPluginCall = PluginCall<[query: string], string>;

interface BillingConfigResponse {
    getBillingConfig: {
        feeReceiver: string;
        enabled: boolean;
    } | null;
}

export const useBillingConfig = (graphql: GraphqlPluginCall) => {
    return useQuery({
        queryKey: [...QueryKey.billingConfig(), graphql.service],
        queryFn: async () => {
            const query = `
                query {
                    getBillingConfig {
                        feeReceiver
                        enabled
                    }
                }
            `;
            const res = await callGraphqlViaPlugin<BillingConfigResponse>(
                graphql,
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
