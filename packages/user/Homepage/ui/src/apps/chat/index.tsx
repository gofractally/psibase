import { AppConfigType } from "@/configured-apps";
import { MessagesSquare } from "lucide-react";

import { zAccount } from "@shared/lib/schemas/account";

import { ChatPage } from "./pages/chat-page";

export const chatConfig: AppConfigType = {
    service: zAccount.parse("chat"),
    name: "Chat",
    description: "Direct and group chat.",
    icon: <MessagesSquare className="h-6 w-6" />,
    isMore: false,
    showLoginLoadingSpinner: true,
    isLoginRequired: true,
    children: [
        {
            path: "",
            element: <ChatPage />,
            name: "Home",
        },
    ],
};
