import { type LucideIcon } from "lucide-react";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";
import { configuredApps } from "@/configuredApps";
import { NavLink } from "react-router-dom";

export interface App {
    name: string;
    url: string;
    icon: LucideIcon;
}

export function NavApps() {
    return (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Native Apps</SidebarGroupLabel>
            <SidebarMenu>
                {configuredApps
                    .filter((app) => !app.isMore)
                    .map((item) => (
                        <SidebarMenuItem key={item.service}>
                            <NavLink to={`/${item.service}`}>
                                {({ isActive }) => (
                                    <SidebarMenuButton
                                        data-active={isActive}
                                        className="data-[active=true]:bg-accent"
                                    >
                                        {item.icon}
                                        <span>{item.name}</span>
                                    </SidebarMenuButton>
                                )}
                            </NavLink>
                        </SidebarMenuItem>
                    ))}
            </SidebarMenu>
        </SidebarGroup>
    );
}
