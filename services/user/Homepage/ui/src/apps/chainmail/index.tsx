import { Mail, PencilLine, Send, Inbox, Archive, Pin } from "lucide-react";

import { Account } from "@/lib/zod/Account";
import { AppConfigType } from "@/configuredApps";

import InboxPage from "./inbox-page";
import DraftsPage from "./drafts-page";
import SentPage from "./sent-page";
import ArchivePage from "./archive-page";
import SavedPage from "./saved-page";

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
            element: <DraftsPage />,
            name: "Drafts",
            icon: <PencilLine className="h-6 w-6" />,
        },
        {
            path: "saved",
            element: <SavedPage />,
            name: "Saved",
            icon: <Pin className="h-6 w-6" />,
        },
        {
            path: "sent",
            element: <SentPage />,
            name: "Sent",
            icon: <Send className="h-6 w-6" />,
        },
        {
            path: "archived",
            element: <ArchivePage />,
            name: "Archived",
            icon: <Archive className="h-6 w-6" />,
        },
    ],
};
