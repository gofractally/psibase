import { AppConfigType } from "@/configuredApps";
import { Coins } from "lucide-react";

import { Account } from "@/lib/zod/Account";

import { TokensLayout } from "./layout";
import { TransferPage } from "./transfer";

export const tokensConfig: AppConfigType = {
    service: Account.parse("tokens"),
    name: "Tokens",
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
            path: "lines-of-credit",
            element: <div>Lines of credit page</div>,
            name: "Lines of credit",
        },
    ],
};
