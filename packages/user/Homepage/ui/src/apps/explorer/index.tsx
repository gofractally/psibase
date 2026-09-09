import { defineAppConfig } from "@/app-config";
import { Blocks } from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

import { zAccount } from "@shared/lib/schemas/account";

import { useExplorerVisibility } from "./hooks/use-explorer-visibility";

export const EXPLORER_SERVICE = zAccount.parse("explorer");

/**
 * The Explorer is a standalone app served from its own subdomain, so it is
 * linked by URL rather than routed inside Homepage.
 */
export const explorerConfig = defineAppConfig({
    service: EXPLORER_SERVICE,
    href: siblingUrl(null, EXPLORER_SERVICE, null),
    name: "Explorer",
    description: "Browse blocks, transactions, and accounts in real time.",
    icon: <Blocks className="h-6 w-6" />,
    isMore: false,
    isLoginRequired: false,
    showLoginLoadingSpinner: false,
    useSidebarVisibility: useExplorerVisibility,
    children: [],
});
