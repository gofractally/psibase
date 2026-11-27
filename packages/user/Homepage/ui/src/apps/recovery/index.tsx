import { defineAppConfig } from "@/app-config";
import { LifeBuoy } from "lucide-react";

import { zAccount } from "@shared/lib/schemas/account";

import { RecoveryPage } from "./page";
import { RECOVERY_PATH } from "./route";

export const recoveryConfig = defineAppConfig({
    service: zAccount.parse("auth-sig"),
    path: RECOVERY_PATH,
    name: "Recovery",
    description: "Accounts you are the recovery partner for.",
    icon: <LifeBuoy className="h-6 w-6" />,
    children: [
        {
            path: "",
            element: <RecoveryPage />,
        },
    ],
});
