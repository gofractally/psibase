import { type SidebarVisibility, defineAppConfig } from "@/app-config";
import { History, Package, ShoppingCart, Store } from "lucide-react";

import { useNameEvents } from "@/apps/prem-accounts/hooks/use-name-events";
import { NAME_EVENTS_EXISTENCE_PAGE_SIZE } from "@/apps/prem-accounts/lib/graphql/namemarket-api";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useAccountMarkets } from "@shared/hooks/use-prem-markets";
import { nameMarket } from "@shared/lib/plugins";
import { hasActiveAccountMarket } from "@shared/lib/schemas/prem-accounts";

import { BuyPage } from "./buy-page";
import { ClaimPage } from "./claim-page";
import { HistoryPage } from "./history-page";
import { AccountMarketplaceLayout } from "./layout";
import { ACCOUNT_MARKETPLACE_PATH } from "./route";

function useAccountMarketplaceSidebarVisibility(): SidebarVisibility {
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

export const accountMarketplaceConfig = defineAppConfig({
    service: nameMarket.service,
    path: ACCOUNT_MARKETPLACE_PATH,
    name: "Account Marketplace",
    description: "Buy and claim account names.",
    icon: <Store className="h-6 w-6" />,
    isMore: false,
    isLoginRequired: true,
    showLoginLoadingSpinner: true,
    useSidebarVisibility: useAccountMarketplaceSidebarVisibility,
    element: <AccountMarketplaceLayout />,
    children: [
        {
            path: "",
            element: <BuyPage />,
            name: "Buy",
            icon: <ShoppingCart className="h-6 w-6" />,
        },
        {
            path: "claim",
            element: <ClaimPage />,
            name: "Claim",
            icon: <Package className="h-6 w-6" />,
        },
        {
            path: "history",
            element: <HistoryPage />,
            name: "History",
            icon: <History className="h-6 w-6" />,
        },
    ],
});
