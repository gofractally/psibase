import { type SidebarVisibility, defineAppConfig } from "@/app-config";
import { History, Package, ShoppingCart, Store } from "lucide-react";

import { usePremPrices } from "@shared/hooks/use-prem-prices";
import { premAccounts } from "@shared/lib/plugins";

import { BuyPage } from "./buy-page";
import { ClaimPage } from "./claim-page";
import { HistoryPage } from "./history-page";
import { PremAccountsLayout } from "./layout";

function usePremAccountsSidebarVisibility(): SidebarVisibility {
    const { data: premPrices, isPending } = usePremPrices();
    if (isPending) return { visible: false, isLoading: true };
    return { visible: Boolean(premPrices?.size), isLoading: false };
}

export const premAccountsConfig = defineAppConfig({
    service: premAccounts.service,
    name: "Accounts Marketplace",
    description: "Buy and claim premium account names.",
    icon: <Store className="h-6 w-6" />,
    isMore: false,
    isLoginRequired: true,
    showLoginLoadingSpinner: true,
    useSidebarVisibility: usePremAccountsSidebarVisibility,
    element: <PremAccountsLayout />,
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
