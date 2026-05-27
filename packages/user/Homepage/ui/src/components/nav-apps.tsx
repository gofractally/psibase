import { type AppConfig, configuredApps } from "@/configured-apps";
import { type LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";

import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSkeleton,
} from "@shared/shadcn/ui/sidebar";

export interface App {
    name: string;
    url: string;
    icon: LucideIcon;
}

const defaultSidebarVisibility = () => ({
    visible: true,
    isLoading: false,
});

function NavAppItem({ app }: { app: AppConfig }) {
    const { visible, isLoading } = (
        app.useSidebarVisibility ?? defaultSidebarVisibility
    )();

    if (isLoading) {
        return (
            <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon />
            </SidebarMenuItem>
        );
    }

    if (!visible) return null;

    return (
        <SidebarMenuItem>
            <NavLink to={`/${app.service}`}>
                {({ isActive }) => (
                    <SidebarMenuButton
                        data-active={isActive}
                        className="data-[active=true]:bg-accent"
                    >
                        {app.icon}
                        <span>{app.name}</span>
                    </SidebarMenuButton>
                )}
            </NavLink>
        </SidebarMenuItem>
    );
}

export function NavApps() {
    return (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Native Apps</SidebarGroupLabel>
            <SidebarMenu>
                {configuredApps
                    .filter((app) => !app.isMore)
                    .map((app) => (
                        <NavAppItem key={app.service} app={app} />
                    ))}
            </SidebarMenu>
        </SidebarGroup>
    );
}
