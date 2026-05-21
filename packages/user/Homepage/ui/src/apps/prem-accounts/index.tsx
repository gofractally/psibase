import { AppConfigType } from "@/configured-apps";
import { History, Package, ShoppingCart, Store } from "lucide-react";

import { zAccount } from "@shared/lib/schemas/account";

import { BuyPage } from "./buy-page";
import { ClaimPage } from "./claim-page";
import { HistoryPage } from "./history-page";
import { PremAccountsLayout } from "./layout";

export const premAccountsConfig: AppConfigType = {
    service: zAccount.parse("prem-accounts"),
    name: "Accounts Marketplace",
    description: "Buy and claim premium account names.",
    icon: <Store className="h-6 w-6" />,
    isMore: false,
    isLoginRequired: true,
    showLoginLoadingSpinner: true,
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
};
