import { Outlet, useLocation } from "react-router-dom";

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

import { AppSidebar } from "@/components/app-sidebar";

import { useCurrentFractal } from "@/hooks/use-current-fractal";

import { fractalMenus } from "./nav-main";

export const Layout = () => {
    const fractal = useCurrentFractal();
    const location = useLocation();

    const pathNameIndex = (index: number) => {
        return location.pathname.split("/")[index];
    };

    const selectedGroup = fractalMenus.find(
        (menu) => pathNameIndex(3) == menu.path,
    );

    const selectedGroupName = selectedGroup?.groupLabel;

    const selectedPage = selectedGroup?.menus.find(
        (menu) => pathNameIndex(4) == menu.path,
    );

    const pageName = selectedPage?.title;

    const breadCrumbs: (string | undefined)[] = [
        fractal || "Browse",
        selectedGroupName,
        pageName,
    ];

    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
                <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
                    <div className="flex items-center gap-2 px-4">
                        <SidebarTrigger className="-ml-1" />
                        <Separator
                            orientation="vertical"
                            className="mr-2 h-4"
                        />
                        <Breadcrumb>
                            <BreadcrumbList>
                                {breadCrumbs
                                    .filter(Boolean)
                                    .map((breadcrumb, index, arr) => (
                                        <>
                                            <BreadcrumbItem className="hidden md:block">
                                                {index === 0 ? (
                                                    <BreadcrumbLink>
                                                        {breadcrumb}
                                                    </BreadcrumbLink>
                                                ) : (
                                                    <BreadcrumbPage>
                                                        {breadcrumb}
                                                    </BreadcrumbPage>
                                                )}
                                            </BreadcrumbItem>
                                            {arr.length - 1 !== index && (
                                                <BreadcrumbSeparator className="hidden md:block" />
                                            )}
                                        </>
                                    ))}
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>
                </header>
                <Outlet />
            </SidebarInset>
        </SidebarProvider>
    );
};
