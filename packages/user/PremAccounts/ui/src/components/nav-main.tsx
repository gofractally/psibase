import { Package, ShoppingCart } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@shared/lib/utils";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

export function NavMain() {
    return (
        <SidebarGroup>
            <SidebarGroupLabel>Premium accounts</SidebarGroupLabel>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Buy">
                        <NavLink
                            to="/"
                            end
                            className={({ isActive }) =>
                                cn(isActive && "bg-muted/50 font-semibold")
                            }
                        >
                            <ShoppingCart />
                            <span>Buy</span>
                        </NavLink>
                    </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Purchased names">
                        <NavLink
                            to="/purchased"
                            className={({ isActive }) =>
                                cn(isActive && "bg-muted/50 font-semibold")
                            }
                        >
                            <Package />
                            <span>Purchased names</span>
                        </NavLink>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarGroup>
    );
}
