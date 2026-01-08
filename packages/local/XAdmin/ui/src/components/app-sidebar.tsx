import {
    FileText,
    Key,
    LayoutDashboard,
    Network,
    Settings,
} from "lucide-react";
import * as React from "react";
import { NavLink } from "react-router-dom";

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

import { useKeyDevices } from "../hooks/useKeyDevices";
import { useStatuses } from "../hooks/useStatuses";
import { MenuContent } from "./menu-content";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const { data: status, isLoading: isLoadingStatus } = useStatuses();
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
                            <NetworkLogo />
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Navigation</SidebarGroupLabel>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <NavLink to="/dashboard">
                                {({ isActive }) => (
                                    <SidebarMenuButton
                                        data-active={isActive}
                                        className="data-[active=true]:bg-accent"
                                    >
                                        <LayoutDashboard />
                                        <span>Dashboard</span>
                                    </SidebarMenuButton>
                                )}
                            </NavLink>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                            <NavLink to="/peers">
                                {({ isActive }) => (
                                    <SidebarMenuButton
                                        data-active={isActive}
                                        className="data-[active=true]:bg-accent"
                                    >
                                        <Network />
                                        <span>Peers</span>
                                    </SidebarMenuButton>
                                )}
                            </NavLink>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                            <NavLink to="/logs">
                                {({ isActive }) => (
                                    <SidebarMenuButton
                                        data-active={isActive}
                                        className="data-[active=true]:bg-accent"
                                    >
                                        <FileText />
                                        <span>Logs</span>
                                    </SidebarMenuButton>
                                )}
                            </NavLink>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                            <NavLink to="/configuration">
                                {({ isActive }) => (
                                    <SidebarMenuButton
                                        data-active={isActive}
                                        className="data-[active=true]:bg-accent"
                                    >
                                        <Settings />
                                        <span>Configuration</span>
                                    </SidebarMenuButton>
                                )}
                            </NavLink>
                        </SidebarMenuItem>
                        {hasKeyDevices && (
                            <SidebarMenuItem>
                                <NavLink to="/keys-and-devices">
                                    {({ isActive }) => (
                                        <SidebarMenuButton
                                            data-active={isActive}
                                            className="data-[active=true]:bg-accent"
                                        >
                                            <Key />
                                            <span>Keys and devices</span>
                                        </SidebarMenuButton>
                                    )}
                                </NavLink>
                            </SidebarMenuItem>
                        )}
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
