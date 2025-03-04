import { Account } from "@/lib/zod/Account";
import { Mail } from "lucide-react";
import { ChainmailPage } from "./page";
import { AppConfigType } from "@/configuredApps";


export const chainMailConfig: AppConfigType = {
    service: Account.parse('chainmail'),
    name: 'Chainmail',
    description: "Send mail between accounts.",
    icon: <Mail className="h-6 w-6" />,
    isMore: false,
    children: [
        {
            path: '',
            element: <ChainmailPage />,
            name: 'Home',
        },
        {
            path: 'inbox',
            element: <div>Inbox page</div>,
            name: 'Inbox'
        },
        {
            path: 'compose',
            element: <div>Compose page</div>,
            name: 'Compose'
        }
    ]
}