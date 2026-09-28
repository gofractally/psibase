import { getAppPath } from "@/app-config";
import { Dot } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { useNavLocation } from "@/hooks/use-nav-location";

import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

export function NavSubNav() {
    const location = useLocation();
    const { currentApp } = useNavLocation();

    if (!currentApp || currentApp.children.length < 2) return null;

    const normalizedPath = location.pathname.replace(/\/+$/, "");
    const base = `/${getAppPath(currentApp)}`;

    return (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>{currentApp.name}</SidebarGroupLabel>
            <SidebarMenu>
                {currentApp.children.map((item) => {
                    const to = item.path ? `${base}/${item.path}` : base;
                    const active = normalizedPath === to;
                    return (
                        <SidebarMenuItem key={item.path}>
                            <SidebarMenuButton
                                asChild
                                isActive={active}
                                tooltip={item.name}
                                size="sm"
                            >
                                <NavLink to={to} end>
                                    {item.icon ?? (
                                        <Dot className="text-muted-foreground" />
                                    )}
                                    <span>{item.name}</span>
                                </NavLink>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    );
                })}
            </SidebarMenu>
        </SidebarGroup>
    );
}
