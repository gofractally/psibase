import { AppConfigType } from "@/configuredApps";
import { BookUser } from "lucide-react";

import { zAccount } from "@/lib/zod/Account";

import { ContactsPage } from "./page";

export const contactsConfig: AppConfigType = {
    service: zAccount.parse("contacts"),
    name: "Contacts",
    description: "Manage your contacts.",
    icon: <BookUser className="h-6 w-6" />,
    isMore: false,
    isLoginRequired: true,
    showLoginLoadingSpinner: true,
    children: [
        {
            path: "",
            element: <ContactsPage />,
            name: "Home",
        },
    ],
};
