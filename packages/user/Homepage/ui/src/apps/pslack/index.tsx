import { AppConfigType } from "@/configured-apps";
import { MessagesSquare } from "lucide-react";

import { zAccount } from "@shared/lib/schemas/account";

import { PslackPage } from "./page";

export const pslackConfig: AppConfigType = {
    service: zAccount.parse("pslack"),
    name: "x-pslack",
    description: "Direct and group chat over websocket.",
    icon: <MessagesSquare className="h-6 w-6" />,
    isMore: false,
    showLoginLoadingSpinner: true,
    isLoginRequired: true,
    children: [
        {
            path: "",
            element: <PslackPage />,
            name: "Chat",
        },
    ],
};
