import { ExternalLink, Terminal } from "lucide-react";
import * as React from "react";
import { Link, NavLink } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import { NetworkLogo } from "@shared/components/network-logo";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

import { useConfig } from "../hooks/useConfig";
import { useKeyDevices } from "../hooks/useKeyDevices";
import { useStatuses } from "../hooks/useStatuses";
import { routes } from "../routing";
import { MenuContent } from "./menu-content";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const { data: status, isLoading: isLoadingStatus } = useStatuses();
    const { data: config } = useConfig();
    const { data: keyDevices } = useKeyDevices();
    const isBootable = status && status.includes("needgenesis");
    const hasKeyDevices = keyDevices && keyDevices.length > 0;

    if (isLoadingStatus) {
        return null;
    }

    return (
        <Sidebar variant="inset" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            asChild
                            onClick={() => {
                                window.top!.location.href = siblingUrl();
                            }}
                        >
                            <NetworkLogo producerName={config?.producer} />
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Node Admin</SidebarGroupLabel>
                    <SidebarMenu>
                        {routes.map((route) => {
                            if (route.secureOnly && !hasKeyDevices) {
                                return null;
                            }

                            return (
                                <SidebarMenuItem key={route.path}>
                                    <NavLink to={route.path}>
                                        {({ isActive }) => (
                                            <SidebarMenuButton
                                                data-active={isActive}
                                                className="data-[active=true]:bg-accent"
                                            >
                                                <route.icon />
                                                <span>{route.name}</span>
                                            </SidebarMenuButton>
                                        )}
                                    </NavLink>
                                </SidebarMenuItem>
                            );
                        })}
                    </SidebarMenu>
                </SidebarGroup>
                <SidebarGroup>
                    <SidebarGroupLabel>Network Admin</SidebarGroupLabel>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <Link
                                to={siblingUrl(undefined, "config")}
                                target="_blank"
                            >
                                <SidebarMenuButton>
                                    <Terminal />
                                    <span>Config</span>
                                    <ExternalLink className="scale-70 -translate-x-1.5 -translate-y-1" />
                                </SidebarMenuButton>
                            </Link>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <div className="flex gap-2 p-2">
                    <MenuContent condense={isBootable} />
                </div>
            </SidebarFooter>
        </Sidebar>
    );
}
