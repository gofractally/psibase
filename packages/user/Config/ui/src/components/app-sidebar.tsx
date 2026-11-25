import * as React from "react";
import { Link } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import { NavMain } from "@/components/nav-main";

import { useNetworkLogoHash } from "@/hooks/use-network-logo-hash";

import { NetworkLogo } from "@shared/components/network-logo";
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
    const { data: logoHash } = useNetworkLogoHash();

    return (
        <Sidebar variant="inset" collapsible="icon" {...props}>
            <SidebarHeader>
                <Link to={siblingUrl()}>
                    <SidebarMenuButton size="lg" asChild>
                        <NetworkLogo logoHash={logoHash ?? undefined} />
                    </SidebarMenuButton>
                </Link>
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
