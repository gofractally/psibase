import * as React from "react";
import { Landmark } from "lucide-react";
import { Link } from "react-router-dom";

import { NavMain } from "@/components/nav-main";

import { UserSidebarNavFooter } from "@shared/components/user-sidebar-nav-footer";
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
        <Sidebar collapsible="icon" {...props}>
            <SidebarHeader>
                <SidebarMenuButton size="lg" asChild>
                    <Link to="/accounts">
                        <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-amber-800 text-white dark:bg-amber-600">
                            <Landmark className="size-4" />
                        </div>
                        <span className="truncate font-semibold">Banx</span>
                    </Link>
                </SidebarMenuButton>
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
