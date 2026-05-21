import { configuredApps } from "@/configured-apps";
import { type LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";

import { useIsPackageInstalled } from "@shared/hooks/use-is-package-installed";
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

const PREM_ACCOUNTS_PACKAGE = "PremAccounts";

export function NavApps() {
    const { data: isPremAccountsInstalled } = useIsPackageInstalled(
        PREM_ACCOUNTS_PACKAGE,
    );

    return (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Native Apps</SidebarGroupLabel>
            <SidebarMenu>
                {configuredApps
                    .filter((app) => !app.isMore)
                    .filter(
                        (app) =>
                            app.service !== "prem-accounts" ||
                            isPremAccountsInstalled === true,
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
