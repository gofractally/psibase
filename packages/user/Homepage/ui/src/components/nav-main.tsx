import { Home } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import {
    SidebarGroup,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

export function NavMain() {
    const location = useLocation();

    return (
        <SidebarGroup>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton
                        asChild
                        isActive={location.pathname === "/"}
                        tooltip="Home"
                    >
                        <NavLink to="/" end>
                            <Home />
                            <span>Home</span>
                        </NavLink>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarGroup>
    );
}
