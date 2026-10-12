import { type SidebarVisibility } from "@/app-config";

import { useNameEvents } from "@/apps/accounts-marketplace/hooks/use-name-events";
import { NAME_EVENTS_EXISTENCE_PAGE_SIZE } from "@/apps/accounts-marketplace/lib/graphql/namemarket-api";

import { useAccountMarkets } from "@shared/hooks/use-account-markets";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { hasActiveAccountMarket } from "@shared/lib/schemas/account-markets";

export function useAccountMarketplaceVisibility(): SidebarVisibility {
    const { data: currentUser, isPending: isPendingUser } = useCurrentUser();
    const {
        data: markets,
        isPending: isPendingMarkets,
        isSuccess: isSuccessMarkets,
    } = useAccountMarkets();
    const isMarketEnabled = hasActiveAccountMarket(markets);

    const { data: history, isLoading: isLoadingHistory } = useNameEvents(
        currentUser,
        {
            first: NAME_EVENTS_EXISTENCE_PAGE_SIZE,
            enabled: isSuccessMarkets && !isMarketEnabled,
        },
    );

    if (isPendingMarkets) {
        return { visible: false, isLoading: true }; // loading
    }

    if (isMarketEnabled) {
        return { visible: true, isLoading: false }; // At least one market is enabled; good enough!
    }

    if (isPendingUser || isLoadingHistory) {
        // actively fetching history for the first time (isLoadingHistory will be false if there's no current user)
        // do not use isPendingHistory here because it will be perpetually true if there's no user logged in
        return { visible: false, isLoading: true }; // No markets are enabled and we are waiting for name events to load
    }

    if (!isMarketEnabled && history?.events.length) {
        return { visible: true, isLoading: false }; // The user has account market history, so we should show it even though no markets are enabled
    }

    return { visible: false, isLoading: false };
}
