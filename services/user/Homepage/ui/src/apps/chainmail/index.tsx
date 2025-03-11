import { Account } from "@/lib/zod/Account";
import { Mail, PencilLine, Send, Inbox, Archive, Pin } from "lucide-react";

import InboxPage from "./inbox-page";
import { AppConfigType } from "@/configuredApps";

export const chainMailConfig: AppConfigType = {
    service: Account.parse("chainmail"),
    name: "Chainmail",
    description: "Send mail between accounts.",
    icon: <Mail className="h-6 w-6" />,
    isMore: false,
    children: [
        {
            path: "",
            element: <InboxPage />,
            name: "Inbox",
            icon: <Inbox className="h-6 w-6" />,
        },
        {
            path: "drafts",
            element: <div>Drafts page</div>,
            name: "Drafts",
            icon: <PencilLine className="h-6 w-6" />,
        },
        {
            path: "saved",
            element: <div>Saved page</div>,
            name: "Saved",
            icon: <Pin className="h-6 w-6" />,
        },
        {
            path: "sent",
            element: <div>Sent page</div>,
            name: "Sent",
            icon: <Send className="h-6 w-6" />,
        },
        {
            path: "archived",
            element: <div>Archived page</div>,
            name: "Archived",
            icon: <Archive className="h-6 w-6" />,
        },
    ],
};
