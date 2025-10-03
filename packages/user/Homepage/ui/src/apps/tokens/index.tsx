import { AppConfigType } from "@/configuredApps";
import { Coins } from "lucide-react";

import { Account } from "@/lib/zod/Account";

import { TokensPage } from "./page";

export const tokensConfig: AppConfigType = {
    service: Account.parse("tokens"),
    name: "Tokens",
    description: "Send tokens and manage balances.",
    icon: <Coins className="h-6 w-6" />,
    isMore: false,
    isLoginRequired: true,
    showLoginLoadingSpinner: true,
    children: [
        {
            path: "",
            element: <TokensPage />,
            name: "Home",
        },
        {
            path: "transfer",
            element: <div>Transfer page!!!!!!!!!!!!!</div>,
            name: "Transfer",
        },
        {
            path: "history",
            element: <div>History page</div>,
            name: "History",
        },
    ],
};
