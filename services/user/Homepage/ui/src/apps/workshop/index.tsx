import { AppConfigType } from "@/configuredApps";
import { Account } from "@/lib/zod/Account";
import { Terminal } from "lucide-react";
import { WorkshopPage } from "./page";



export const workshopConfig: AppConfigType = {
    service: Account.parse('workshop'),
    name: 'Workshop',
    description: "Create and manage workshops.",
    icon: <Terminal className="h-6 w-6" />,
    isMore: false,
    children: [
        {
            path: '',
            element: <WorkshopPage />,
            name: 'Home',
        },
    ],
}