import { defineAppConfig } from "@/app-config";
import { Store } from "lucide-react";

import { nameMarket } from "@shared/lib/plugins";

import { BuyPage } from "./buy-page";
import { ClaimPage } from "./claim-page";
import { HistoryPage } from "./history-page";
import { AccountMarketplaceLayout } from "./layout";
import { ACCOUNT_MARKETPLACE_PATH } from "./route";

export const accountMarketplaceConfig = defineAppConfig({
    service: nameMarket.service,
    path: ACCOUNT_MARKETPLACE_PATH,
    name: "Account Marketplace",
    description: "Buy and claim account names.",
    icon: <Store className="h-6 w-6" />,
    element: <AccountMarketplaceLayout />,
    children: [
        {
            path: "",
            element: <BuyPage />,
            name: "Buy",
        },
        {
            path: "claim",
            element: <ClaimPage />,
            name: "Claim",
        },
        {
            path: "history",
            element: <HistoryPage />,
            name: "History",
        },
    ],
});
