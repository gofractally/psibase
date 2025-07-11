import { Command } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";

import { NavApps } from "@/components/nav-apps";
import { NavUser } from "@/components/nav-user";

import { useBranding } from "@/hooks/use-branding";

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { Developers } from "./Developers";
import { NavMain } from "./nav-main";
import { NavSubNav } from "./nav-sub-nav";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const { data: networkName, isLoading } = useBranding();
    const navigate = useNavigate();

    return (
        <Sidebar variant="inset" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <div
                                role="button"
                                onClick={() => navigate("/")}
                                className="flex cursor-pointer"
                            >
                                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                                    <Command className="size-4" />
                                </div>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    {isLoading ? (
                                        <Skeleton className="h-4 w-[100px]" />
                                    ) : (
                                        <span className="truncate font-semibold">
                                            {networkName}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                <NavMain />
                <NavApps />
                <NavSubNav />
            </SidebarContent>
            <SidebarFooter>
                <Developers />
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    );
}
