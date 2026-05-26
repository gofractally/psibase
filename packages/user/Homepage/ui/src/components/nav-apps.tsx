import { configuredApps } from "@/configured-apps";
import { type LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";

import { useIsPackageInstalled } from "@shared/hooks/use-is-package-installed";
import { useSystemToken } from "@shared/hooks/use-system-token";
import { premAccounts } from "@shared/lib/plugins";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

export interface App {
    name: string;
    url: string;
    icon: LucideIcon;
}

export function NavApps() {
    const { data: systemToken } = useSystemToken();
    const { data: isPremAccountsInstalled } =
        useIsPackageInstalled("PremAccounts");

    const isBuyEnabled = Boolean(isPremAccountsInstalled && systemToken);

    return (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Native Apps</SidebarGroupLabel>
            <SidebarMenu>
                {configuredApps
                    .filter((app) => !app.isMore)
                    .filter(
                        (app) =>
                            app.service !== premAccounts.service ||
                            isBuyEnabled,
                    )
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
