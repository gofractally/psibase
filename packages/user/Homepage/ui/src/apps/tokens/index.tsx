import { AppConfigType } from "@/configuredApps";
import { Coins } from "lucide-react";

import { Account } from "@/lib/zod/Account";

import { TokensLayout } from "./layout";
import { PendingPage } from "./pending";
import { TransferPage } from "./transfer";

export const tokensConfig: AppConfigType = {
    service: Account.parse("tokens"),
    name: "Wallet",
    description: "Send tokens and manage balances.",
    icon: <Coins className="h-6 w-6" />,
    isMore: false,
    isLoginRequired: true,
    showLoginLoadingSpinner: true,
    element: <TokensLayout />,
    children: [
        {
            path: "",
            element: <TransferPage />,
            name: "Transfer",
        },
        {
            path: "Pending",
            element: <PendingPage />,
            name: "Pending",
        },
    ],
};
