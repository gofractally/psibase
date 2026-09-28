import { ExternalLink, Terminal } from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

export const Developers = () => {
    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton
                    asChild
                    size="sm"
                    tooltip="Developers"
                    className="text-muted-foreground"
                >
                    <a
                        href={siblingUrl(null, "workshop", null)}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Terminal />
                        <span>Developers</span>
                        <ExternalLink className="ml-auto !size-3" />
                    </a>
                </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
    );
};
