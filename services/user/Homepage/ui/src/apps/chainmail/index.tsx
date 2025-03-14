import { AppConfigType } from "@/configuredApps";
import { Inbox, Mail, PencilLine, Send } from "lucide-react";

import { Account } from "@/lib/zod/Account";

import DraftsPage from "./drafts-page";
import InboxPage from "./inbox-page";
import SentPage from "./sent-page";

export const chainMailConfig: AppConfigType = {
    service: Account.parse("chainmail"),
    name: "Chain mail",
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
            element: <DraftsPage />,
            name: "Drafts",
            icon: <PencilLine className="h-6 w-6" />,
        },
        // {
        //     path: "saved",
        //     element: <SavedPage />,
        //     name: "Saved",
        //     icon: <Pin className="h-6 w-6" />,
        // },
        {
            path: "sent",
            element: <SentPage />,
            name: "Sent",
            icon: <Send className="h-6 w-6" />,
        },
        // {
        //     path: "archived",
        //     element: <ArchivePage />,
        //     name: "Archived",
        //     icon: <Archive className="h-6 w-6" />,
        // },
    ],
};
