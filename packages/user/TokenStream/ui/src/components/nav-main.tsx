import { LayoutList } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

export function NavMain() {
    const location = useLocation();
    const isStreamsActive =
        location.pathname === "/" || location.pathname === "";

    return (
        <SidebarGroup>
            <SidebarGroupLabel>Token stream</SidebarGroupLabel>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton
                        asChild
                        isActive={isStreamsActive}
                        tooltip="Streams"
                    >
                        <NavLink to="/" end>
                            <LayoutList />
                            <span>Streams</span>
                        </NavLink>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarGroup>
    );
}
