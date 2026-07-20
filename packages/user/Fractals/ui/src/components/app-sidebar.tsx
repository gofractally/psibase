import * as React from "react";
import { Link } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import { CreateFractalModal } from "@/components/create-fractal-modal";
import { NavMain } from "@/components/nav-main";

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
    const [createFractalOpen, setCreateFractalOpen] = React.useState(false);

    const openCreateFractal = () => {
        setCreateFractalOpen(true);
    };

    return (
        <Sidebar {...props}>
            <CreateFractalModal
                openChange={setCreateFractalOpen}
                show={createFractalOpen}
            />
            <SidebarHeader>
                <Link to={siblingUrl()}>
                    <SidebarMenuButton size="lg" asChild>
                        <NetworkLogo />
                    </SidebarMenuButton>
                </Link>
            </SidebarHeader>
            <SidebarContent>
                <NavMain onOpenCreateFractal={openCreateFractal} />
            </SidebarContent>
            <SidebarFooter>
                <UserSidebarNavFooter />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
