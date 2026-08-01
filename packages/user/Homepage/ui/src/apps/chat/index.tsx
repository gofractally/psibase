import { defineAppConfig } from "@/app-config";
import { MessagesSquare } from "lucide-react";

import { ChatAppShell } from "./chat-app-shell";
import { CHAT_SERVICE } from "./lib/chat-service";
import { RealtimePresencePage } from "./pages/realtime-presence-page";

export const chatConfig = defineAppConfig({
    service: CHAT_SERVICE,
    name: "Chat",
    description: "Realtime presence.",
    icon: <MessagesSquare className="h-6 w-6" />,
    isMore: false,
    showLoginLoadingSpinner: true,
    isLoginRequired: true,
    children: [
        {
            path: "",
            element: (
                <ChatAppShell>
                    <RealtimePresencePage />
                </ChatAppShell>
            ),
            name: "Home",
        },
    ],
});
