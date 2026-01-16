import * as React from "react";
import { useNavigate } from "react-router-dom";

import { NavApps } from "@/components/nav-apps";
import { NavUser } from "@/components/nav-user";

import { NetworkLogo } from "@shared/components/network-logo";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

import { Developers } from "./Developers";
import { NavAdmin } from "./nav-admin";
import { NavMain } from "./nav-main";
import { NavSubNav } from "./nav-sub-nav";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const navigate = useNavigate();

    return (
        <Sidebar variant="inset" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            asChild
                            onClick={() => navigate("/")}
                        >
                            <NetworkLogo />
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                <NavMain />
                <NavApps />
                <NavSubNav />
                <NavAdmin />
            </SidebarContent>
            <SidebarFooter>
                <Developers />
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    );
}
