import { Outlet, useLocation } from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";

import { useGuildMembershipsOfUser } from "@/hooks/fractals/use-guild-memberships";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";

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

import { getMenuGroups } from "./nav-main";

export const Layout = () => {
    const fractal = useFractalAccount();
    const location = useLocation();
    const { data: currentUser } = useCurrentUser();
    const { data: memberships } = useGuildMembershipsOfUser(currentUser);

    const menuGroups = getMenuGroups(memberships);

    // Find breadcrumb data from the nested menu structure
    const findBreadcrumbData = (pathname: string) => {
        for (const group of menuGroups) {
            // Check direct items (like "Guilds")
            for (const item of group.items) {
                if (item.path && pathname === item.path) {
                    return {
                        groupLabel: group.groupLabel,
                        parentMenu: undefined,
                        pageName: item.title,
                    };
                }

                // Check sub-items
                if (item.subItems) {
                    for (const subItem of item.subItems) {
                        if (pathname === subItem.path) {
                            return {
                                groupLabel: group.groupLabel,
                                parentMenu: item.title,
                                pageName: subItem.title,
                            };
                        }
                    }
                }
            }
        }
        return null;
    };

    const breadcrumbData = findBreadcrumbData(location.pathname);

    const breadCrumbs: (string | undefined)[] = [
        fractal || "Browse",
        breadcrumbData?.groupLabel,
        breadcrumbData?.parentMenu,
        breadcrumbData?.pageName,
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
