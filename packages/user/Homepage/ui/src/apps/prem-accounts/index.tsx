import { AppConfigType } from "@/configured-apps";
import { Package, ShoppingCart, Store } from "lucide-react";

import { zAccount } from "@shared/lib/schemas/account";

import { BuyPage } from "./buy-page";
import { ClaimPage } from "./claim-page";

export const premAccountsConfig: AppConfigType = {
    service: zAccount.parse("prem-accounts"),
    name: "Accounts Marketplace",
    description: "Buy and claim premium account names.",
    icon: <Store className="h-6 w-6" />,
    isMore: false,
    isLoginRequired: true,
    showLoginLoadingSpinner: true,
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
    ],
};
