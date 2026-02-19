import { AppConfigType } from "@/configuredApps";
import { Settings } from "lucide-react";

import { zAccount } from "@shared/lib/schemas/account";

import { SettingsPage } from "./page";

export const settingsConfig: AppConfigType = {
    service: zAccount.parse("homepage"),
    name: "User Settings",
    description: "Manage your profile and settings.",
    icon: <Settings className="h-6 w-6" />,
    isMore: false,
    isLoginRequired: true,
    showLoginLoadingSpinner: true,
    children: [
        {
            path: "settings",
            element: <SettingsPage />,
            name: "Settings",
        },
    ],
};
