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
    const isHomeActive =
        location.pathname === "/" || location.pathname === "";

    return (
        <SidebarGroup>
            <SidebarGroupLabel>{"{{project-name}}"}</SidebarGroupLabel>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton
                        asChild
                        isActive={isHomeActive}
                        tooltip="Home"
                    >
                        <NavLink to="/" end>
                            <LayoutList />
                            <span>Home</span>
                        </NavLink>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarGroup>
    );
}
