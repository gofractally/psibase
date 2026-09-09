import { type AppConfig, configuredApps } from "@/configured-apps";
import { getAppPath, isExternalApp } from "@/app-config";
import { ExternalLink, type LucideIcon } from "lucide-react";
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

    if (isExternalApp(app)) {
        return (
            <SidebarMenuItem>
                <a href={app.href}>
                    <SidebarMenuButton>
                        {app.icon}
                        <span>{app.name}</span>
                        <ExternalLink className="scale-70 -translate-x-1.5 -translate-y-1" />
                    </SidebarMenuButton>
                </a>
            </SidebarMenuItem>
        );
    }

    return (
        <SidebarMenuItem>
            <NavLink to={`/${getAppPath(app)}`}>
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
