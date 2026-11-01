import { defineAppConfig } from "@/app-config";
import { Coins } from "lucide-react";

import { SwapPage } from "@/apps/token-swap/page";

import { zAccount } from "@shared/lib/schemas/account";

import { TokensLayout } from "./layout";
import { PendingPage } from "./pending";
import { TransferPage } from "./transfer";

export const tokensConfig = defineAppConfig({
    service: zAccount.parse("tokens"),
    name: "Wallet",
    description: "Send, receive and swap tokens.",
    icon: <Coins className="h-6 w-6" />,
    element: <TokensLayout />,
    children: [
        {
            path: "",
            element: <TransferPage />,
        },
        {
            path: "Pending",
            element: <PendingPage />,
        },
        {
            path: "swap",
            element: <SwapPage />,
        },
    ],
});
