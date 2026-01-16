import { ExternalLink, Settings, Terminal } from "lucide-react";
import { Link } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import { useIsCurrentUserProducer } from "@/hooks/use-producers";

import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

export function NavAdmin() {
    const isCurrentUserProducer = useIsCurrentUserProducer();
    if (!isCurrentUserProducer) return null;
    return (
        <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarMenu>
                <SidebarMenuItem>
                    <Link
                        to={siblingUrl(undefined, "x-admin", undefined, false)}
                        target="_blank"
                    >
                        <SidebarMenuButton>
                            <Settings />
                            <span>X-Admin</span>
                            <ExternalLink className="scale-70 -translate-x-1.5 -translate-y-1" />
                        </SidebarMenuButton>
                    </Link>
                </SidebarMenuItem>
                <SidebarMenuItem>
                    <Link
                        to={siblingUrl(undefined, "config", undefined, false)}
                        target="_blank"
                    >
                        <SidebarMenuButton>
                            <Terminal />
                            <span>Config</span>
                            <ExternalLink className="scale-70 -translate-x-1.5 -translate-y-1" />
                        </SidebarMenuButton>
                    </Link>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarGroup>
    );
}
