import { Account } from "@/lib/zod/Account";
import { Mail } from "lucide-react";

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
        },
        {
            path: "drafts",
            element: <div>Drafts page</div>,
            name: "Drafts",
        },
        {
            path: "saved",
            element: <div>Saved page</div>,
            name: "Saved",
        },
        {
            path: "sent",
            element: <div>Sent page</div>,
            name: "Sent",
        },
        {
            path: "archived",
            element: <div>Archived page</div>,
            name: "Archived",
        },
    ],
};
