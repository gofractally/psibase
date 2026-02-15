import { AppConfigType } from "@/configuredApps";
import { ArrowRightLeft } from "lucide-react";

import { zAccount } from "@shared/lib/schemas/account";

import { SwapPage } from "./page";

export const tokenSwapConfig: AppConfigType = {
    service: zAccount.parse("token-swap"),
    name: "Swap",
    description: "Trade tokens.",
    icon: <ArrowRightLeft className="h-6 w-6" />,
    isMore: false,
    isLoginRequired: true,
    showLoginLoadingSpinner: true,
    children: [
        {
            path: "",
            element: <SwapPage />,
            name: "Home",
        },
    ],
};
