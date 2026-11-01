import { useMemo } from "react";

import { useBillingConfig } from "@shared/hooks/use-billing-config";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useSystemToken } from "@shared/hooks/use-system-token";

import { useUserResources } from "./use-user-resources";

/**
 * Usage credits are the prepaid balance every action on the network draws
 * from. `level` is how full the reserve is, measured from the auto top-up
 * threshold (0%) to capacity (100%).
 */
export const useUsageCredits = () => {
    const { data: currentUser } = useCurrentUser();
    const { data: billingConfig, isLoading: isLoadingBilling } =
        useBillingConfig();
    const enabled = !isLoadingBilling && !!billingConfig?.feeReceiver;
    const { data: systemToken } = useSystemToken();
    const resources = useUserResources(currentUser, { enabled });

    const level = useMemo(() => {
        const r = resources.data;
        if (!r || r.bufferCapacity === 0) return 0;
        const ratio = r.balance / r.bufferCapacity;
        const threshold = r.autoFillThresholdPercent / 100;
        if (ratio <= threshold) return 0;
        return Math.max(
            0,
            Math.min(100, ((ratio - threshold) / (1 - threshold)) * 100),
        );
    }, [resources.data]);

    return {
        /** False when the network doesn't charge for usage. */
        enabled,
        isLoading: isLoadingBilling || (enabled && resources.isLoading),
        resources: resources.data ?? null,
        error: resources.error,
        level,
        symbol: systemToken?.symbol,
    };
};

export const levelTone = (level: number) =>
    level <= 15
        ? "oklch(0.645 0.246 16.439)"
        : level <= 40
          ? "oklch(0.769 0.188 70.08)"
          : "oklch(0.696 0.17 162.48)";
