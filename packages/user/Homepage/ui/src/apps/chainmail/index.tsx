import { defineAppConfig } from "@/app-config";
import { MessageCircle } from "lucide-react";

import { zAccount } from "@shared/lib/schemas/account";

import ChatPage from "./page";

export const chainMailConfig = defineAppConfig({
    service: zAccount.parse("chainmail"),
    name: "Chain mail",
    description: "Chat with anyone on the network.",
    icon: <MessageCircle className="h-6 w-6" />,
    fill: true,
    children: [
        {
            path: "",
            element: <ChatPage />,
        },
    ],
});
