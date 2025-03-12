import { AppConfigType } from "@/configuredApps";
import { Account } from "@/lib/zod/Account";
import { BookUser } from "lucide-react";
import { ContactsPage } from "./page";

export const contactsConfig: AppConfigType = {
    service: Account.parse("contacts"),
    name: "Contacts",
    description: "Manage your contacts.",
    icon: <BookUser className="h-6 w-6" />,
    isMore: false,
    children: [
        {
            path: "",
            element: <ContactsPage />,
            name: "Home",
        },
    ],
};
