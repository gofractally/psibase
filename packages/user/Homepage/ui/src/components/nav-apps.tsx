import { getAppPath, isExternalApp } from "@/app-config";
import { type AppConfig, configuredApps } from "@/configured-apps";
import { ExternalLink } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { useConversations } from "@/apps/chainmail/hooks/use-conversations";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSkeleton,
} from "@shared/shadcn/ui/sidebar";

const defaultSidebarVisibility = () => ({
    visible: true,
    isLoading: false,
});

function NavAppItem({ app, badge }: { app: AppConfig; badge?: number }) {
    const location = useLocation();
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
                <SidebarMenuButton asChild tooltip={app.name}>
                    <a href={app.href}>
                        {app.icon}
                        <span>{app.name}</span>
                        <ExternalLink className="text-muted-foreground ml-auto !size-3" />
                    </a>
                </SidebarMenuButton>
            </SidebarMenuItem>
        );
    }

    const to = `/${getAppPath(app)}`;
    const active =
        location.pathname === to || location.pathname.startsWith(`${to}/`);

    return (
        <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={active} tooltip={app.name}>
                <NavLink to={to}>
                    {app.icon}
                    <span>{app.name}</span>
                </NavLink>
            </SidebarMenuButton>
            {!!badge && (
                <SidebarMenuBadge className="rounded-full bg-[var(--brand)] px-1.5 text-[10px] tabular-nums text-[var(--brand-foreground)]">
                    {badge}
                </SidebarMenuBadge>
            )}
        </SidebarMenuItem>
    );
}

export function NavApps() {
    const { data: user } = useCurrentUser();
    const { unreadTotal } = useConversations();
    const badges: Record<string, number> = user
        ? { chainmail: unreadTotal }
        : {};

    return (
        <SidebarGroup>
            <SidebarGroupLabel>Apps</SidebarGroupLabel>
            <SidebarMenu>
                {configuredApps
                    .filter((app) => !app.isMore)
                    .map((app) => (
                        <NavAppItem
                            key={app.service}
                            app={app}
                            badge={badges[app.service]}
                        />
                    ))}
            </SidebarMenu>
        </SidebarGroup>
    );
}
