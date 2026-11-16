import { Outlet, useLocation } from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";
import { CreateThreadHost, useOpenCreateThread } from "@/components/create-thread-host";
import { Notifications } from "@/components/notifications";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
} from "@shared/shadcn/ui/sidebar";

const LayoutFrame = () => {
    const fractalAccount = useFractalAccount();
    const { data: fractal } = useFractal();
    const openCreateThread = useOpenCreateThread();
    const threadPage = useLocation().pathname.startsWith("/threads");

    return (
        <SidebarProvider>
            <AppSidebar variant="inset" />
            <SidebarInset className={threadPage ? "bg-black" : undefined}>
                <header
                    className={cn(
                        "sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b px-3 backdrop-blur",
                        threadPage
                            ? "border-[#2f3336] bg-black/90"
                            : "bg-background/90",
                    )}
                >
                    <SidebarTrigger />
                    <span className="truncate text-sm font-semibold">
                        {fractal?.fractal?.name ?? fractalAccount}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                        {threadPage && (
                            <Button
                                className="h-8 rounded-full px-4 text-sm font-bold"
                                onClick={openCreateThread}
                            >
                                Create thread
                            </Button>
                        )}
                        <Notifications />
                    </div>
                </header>
                <Outlet />
            </SidebarInset>
        </SidebarProvider>
    );
};

export const Layout = () => (
    <CreateThreadHost>
        <LayoutFrame />
    </CreateThreadHost>
);
