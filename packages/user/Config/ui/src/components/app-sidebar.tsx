import * as React from "react";
import { Link } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";

import { NetworkLogo } from "@shared/components/network-logo";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenuButton,
    SidebarRail,
} from "@shared/shadcn/ui/sidebar";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    return (
        <Sidebar {...props}>
            <SidebarHeader>
                <Link to={siblingUrl()}>
                    <SidebarMenuButton size="lg" asChild>
                        <NetworkLogo />
                    </SidebarMenuButton>
                </Link>
            </SidebarHeader>
            <SidebarContent>
                <NavMain />
            </SidebarContent>
            <SidebarFooter>
                <NavUser />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
