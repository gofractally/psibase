import { Outlet } from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";

import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
} from "@shared/shadcn/ui/sidebar";

export const Layout = () => {
    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
                <header className="flex h-16 shrink-0 items-center px-3 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
                    <SidebarTrigger />
                </header>
                <Outlet />
            </SidebarInset>
        </SidebarProvider>
    );
};
