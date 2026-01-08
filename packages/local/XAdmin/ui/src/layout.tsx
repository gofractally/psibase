import { Outlet } from "react-router-dom";

import { AppSidebar } from "./components/app-sidebar";
import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
} from "@shared/shadcn/ui/sidebar";
import { Separator } from "@shared/shadcn/ui/separator";

export const Layout = () => {
    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
                <header className="flex h-16 shrink-0 items-center gap-2">
                    <div className="flex items-center gap-2 px-4">
                        <SidebarTrigger className="-ml-1" />
                        <Separator
                            orientation="vertical"
                            className="mr-2 h-4"
                        />
                    </div>
                </header>
                <Outlet />
            </SidebarInset>
        </SidebarProvider>
    );
};

