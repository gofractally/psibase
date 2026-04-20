import * as React from "react";
import { useNavigate } from "react-router-dom";

import { MainNavigation } from "@/components/nav";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";

import { UserSidebarNavFooter } from "@shared/components/user-sidebar-nav-footer";
import { FractalGuildIdentifier } from "@shared/domains/fractal/components/fractal-guild-header-identifier";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from "@shared/shadcn/ui/sidebar";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const navigate = useNavigate();

    const fractalAccount = useFractalAccount();
    const { data: fractal } = useFractal();

    return (
        <Sidebar {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            onClick={() => navigate("/")}
                        >
                            <FractalGuildIdentifier
                                size="sm"
                                name={fractal?.fractal?.name}
                                account={fractalAccount}
                            />
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                <MainNavigation />
            </SidebarContent>
            <SidebarFooter>
                <UserSidebarNavFooter />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
