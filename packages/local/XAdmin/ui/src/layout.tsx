import { Outlet, useLocation, useNavigate } from "react-router-dom";

import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@shared/shadcn/ui/breadcrumb";
import { Separator } from "@shared/shadcn/ui/separator";
import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
} from "@shared/shadcn/ui/sidebar";

import { AppSidebar } from "./components/app-sidebar";
import { routes } from "./routing";

export const Layout = () => {
    const location = useLocation();
    const navigate = useNavigate();

    // Extract the current route path from location (e.g., "/dashboard" -> "dashboard")
    const currentPath =
        location.pathname.split("/").filter(Boolean).pop() || "";

    // Find the matching route
    const currentRoute = routes.find((route) => route.path === currentPath);

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
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem
                                    onClick={() => navigate("/dashboard")}
                                    className="hidden cursor-pointer select-none md:block"
                                >
                                    <BreadcrumbLink>Dashboard</BreadcrumbLink>
                                </BreadcrumbItem>
                                {currentRoute &&
                                    currentRoute.path !== "dashboard" && (
                                        <>
                                            <BreadcrumbSeparator className="hidden md:block" />
                                            <BreadcrumbItem className="cursor-pointer select-none">
                                                <BreadcrumbPage>
                                                    {currentRoute.name}
                                                </BreadcrumbPage>
                                            </BreadcrumbItem>
                                        </>
                                    )}
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>
                </header>
                <Outlet />
            </SidebarInset>
        </SidebarProvider>
    );
};
