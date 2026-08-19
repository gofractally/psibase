import { defineAppConfig } from "@/app-config";
import { History, Package, ShoppingCart, Store } from "lucide-react";

import { nameMarket } from "@shared/lib/plugins";

import { BuyPage } from "./buy-page";
import { ClaimPage } from "./claim-page";
import { HistoryPage } from "./history-page";
import { useAccountMarketplaceVisibility } from "./hooks/use-account-marketplace-visibility";
import { AccountMarketplaceLayout } from "./layout";
import { ACCOUNT_MARKETPLACE_PATH } from "./route";

export const accountMarketplaceConfig = defineAppConfig({
    service: nameMarket.service,
    path: ACCOUNT_MARKETPLACE_PATH,
    name: "Account Marketplace",
    description: "Buy and claim account names.",
    icon: <Store className="h-6 w-6" />,
    isMore: false,
    isLoginRequired: true,
    showLoginLoadingSpinner: true,
    useSidebarVisibility: useAccountMarketplaceVisibility,
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
