import { useQuery } from "@tanstack/react-query";

import { useBillingConfig } from "@shared/hooks/use-billing-config";
import { useSystemToken } from "@shared/hooks/use-system-token";
import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { tokens } from "@shared/lib/plugins";
import QueryKey from "@shared/lib/query-keys";

interface TokenSettingsResponse {
    token: {
        settings: {
            untransferable: boolean;
        };
    } | null;
}

/**
 * Private network: billing is enabled and the system token is not transferable.
 */
export const useIsPrivateNetwork = () => {
    const {
        data: billingConfig,
        isLoading: isLoadingBilling,
        isPending: isPendingBilling,
    } = useBillingConfig();
    const { data: systemToken, isLoading: isLoadingSystemToken } =
        useSystemToken();

    const transferableQuery = useQuery({
        queryKey: [...QueryKey.systemToken(), "transferable", systemToken?.id],
        enabled: !!systemToken?.id,
        queryFn: async (): Promise<boolean> => {
            const res = await callGraphqlViaPlugin<TokenSettingsResponse>(
                tokens.authorized.graphql,
                `query {
                    token(tokenId: "${systemToken!.id}") {
                        settings {
                            untransferable
                        }
                    }
                }`,
            );
            if (!res.token) {
                return true;
            }
            return !res.token.settings.untransferable;
        },
    });

    const billingEnabled = !!billingConfig?.enabled;
    const isTransferable = transferableQuery.data;
    const isPrivateNetwork =
        billingEnabled && isTransferable === false;

    return {
        isPrivateNetwork,
        billingEnabled,
        isTransferable,
        isLoading:
            isLoadingBilling ||
            isPendingBilling ||
            isLoadingSystemToken ||
            (!!systemToken?.id && transferableQuery.isLoading),
    };
};
