import { Settings, Terminal } from "lucide-react";
import { NavLink } from "react-router-dom";

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
                    <NavLink
                        to={siblingUrl(undefined, "x-admin", undefined, false)}
                    >
                        {({ isActive }) => (
                            <SidebarMenuButton
                                data-active={isActive}
                                className="data-[active=true]:bg-accent"
                            >
                                <Settings />
                                <span>X-Admin</span>
                            </SidebarMenuButton>
                        )}
                    </NavLink>
                </SidebarMenuItem>
                <SidebarMenuItem>
                    <NavLink
                        to={siblingUrl(undefined, "config", undefined, false)}
                    >
                        {({ isActive }) => (
                            <SidebarMenuButton
                                data-active={isActive}
                                className="data-[active=true]:bg-accent"
                            >
                                <Terminal />
                                <span>Config</span>
                            </SidebarMenuButton>
                        )}
                    </NavLink>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarGroup>
    );
}
