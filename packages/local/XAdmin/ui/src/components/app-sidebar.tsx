import * as React from "react";
import {
    LayoutDashboard,
    Network,
    FileText,
    Settings,
    Key,
} from "lucide-react";
import { NavLink } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import { useBranding } from "@shared/hooks/use-branding";
import { HoverBorderGradient } from "@shared/components/hover-border-gradient";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarGroup,
    SidebarGroupLabel,
} from "@shared/shadcn/ui/sidebar";

import { useKeyDevices } from "../hooks/useKeyDevices";
import { useStatuses } from "../hooks/useStatuses";
import { MenuContent } from "./menu-content";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const { data: status, isLoading: isLoadingStatus } = useStatuses();
    const { data: keyDevices } = useKeyDevices();
    const isBootable = status && status.includes("needgenesis");
    const hasKeyDevices = keyDevices && keyDevices.length > 0;
    const { data: networkName } = useBranding({ enabled: !isBootable });

    if (isLoadingStatus) {
        return null;
    }

    return (
        <Sidebar variant="inset" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <a
                                href={siblingUrl()}
                                title={`${networkName || "Network"} home`}
                            >
                                <HoverBorderGradient
                                    as="div"
                                    containerClassName="rounded-full"
                                    className="flex items-center space-x-2 bg-white text-black dark:bg-black dark:text-white"
                                >
                                    <span>{networkName || "Network"}</span>
                                </HoverBorderGradient>
                            </a>
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

