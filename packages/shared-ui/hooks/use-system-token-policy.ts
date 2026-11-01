import { useBillingConfig } from "@shared/hooks/use-billing-config";
import { useSystemToken } from "@shared/hooks/use-system-token";

export const useSystemTokenPolicy = () => {
    const {
        data: billingConfig,
        isLoading: isLoadingBilling,
        isPending: isPendingBilling,
    } = useBillingConfig();
    const { data: systemToken, isLoading: isLoadingSystemToken } =
        useSystemToken();

    const billingEnabled = !!billingConfig?.enabled;
    const isTransferable =
        systemToken == null ? undefined : !systemToken.untransferable;
    const restrictsSelfService = billingEnabled && isTransferable === false;

    return {
        restrictsSelfService,
        billingEnabled,
        isTransferable,
        isLoading: isLoadingBilling || isPendingBilling || isLoadingSystemToken,
    };
};
