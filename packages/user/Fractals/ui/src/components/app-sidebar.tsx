import * as React from "react";

import { AppSwitcher } from "@/components/fractal-switcher";
import { NavMain } from "@/components/nav-main";

import { UserSidebarNavFooter } from "@shared/components/user-sidebar-nav-footer";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarRail,
} from "@shared/shadcn/ui/sidebar";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    return (
        <Sidebar {...props}>
            <SidebarHeader>
                <AppSwitcher />
            </SidebarHeader>
            <SidebarContent>
                <NavMain />
            </SidebarContent>
            <SidebarFooter>
                <UserSidebarNavFooter />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
