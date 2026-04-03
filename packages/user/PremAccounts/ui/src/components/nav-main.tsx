import { type LucideIcon, Package, ShoppingCart } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@shared/lib/utils";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

export type PremAccountNavItem = {
    title: string;
    path: string;
    end?: boolean;
    icon: LucideIcon;
};

export const premAccountNavItems: PremAccountNavItem[] = [
    { title: "Buy name", path: "/", end: true, icon: ShoppingCart },
    { title: "Claim name", path: "/purchased", end: true, icon: Package },
];

export function NavMain() {
    return (
        <SidebarGroup>
            <SidebarGroupLabel>Premium accounts</SidebarGroupLabel>
            <SidebarMenu>
                {premAccountNavItems.map((item) => {
                    const Icon = item.icon;
                    return (
                        <SidebarMenuItem key={item.path}>
                            <SidebarMenuButton asChild tooltip={item.title}>
                                <NavLink
                                    to={item.path}
                                    end={item.end}
                                    className={({ isActive }) =>
                                        cn(
                                            isActive &&
                                                "bg-muted/50 font-semibold",
                                        )
                                    }
                                >
                                    <Icon />
                                    <span>{item.title}</span>
                                </NavLink>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    );
                })}
            </SidebarMenu>
        </SidebarGroup>
    );
}
