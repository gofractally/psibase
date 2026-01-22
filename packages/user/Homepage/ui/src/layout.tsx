import { Outlet, useNavigate } from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";
import { AppSplashScreen } from "@/components/app-splash-screen";
import { Loading } from "@/components/loading";

import { useCurrentUser } from "@/hooks/use-current-user";
import { useNavLocation } from "@/hooks/use-nav-location";

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

export const Layout = () => {
    const navigate = useNavigate();
    const { currentApp, currentChild } = useNavLocation();

    const primaryNavLabel = currentApp?.name ?? "Dashboard";
    const secondaryNavLabel = currentChild?.name;

    const { data: currentUser, isPending: isPendingCurrentUser } =
        useCurrentUser();

    const isAppRequiringLogin =
        currentApp?.isLoginRequired || currentChild?.isLoginRequired;

    const isNotLoggedIn = !currentUser && !isPendingCurrentUser;

    const isLoginRequired = isAppRequiringLogin && isNotLoggedIn;

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
                                    onClick={() =>
                                        navigate(`/${currentApp?.service}`)
                                    }
                                    className="hidden md:block"
                                >
                                    <BreadcrumbLink>
                                        {primaryNavLabel}
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                {secondaryNavLabel && (
                                    <BreadcrumbSeparator className="hidden md:block" />
                                )}
                                {secondaryNavLabel && (
                                    <BreadcrumbItem>
                                        <BreadcrumbPage>
                                            {secondaryNavLabel}
                                        </BreadcrumbPage>
                                    </BreadcrumbItem>
                                )}
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>
                </header>
                {isLoginRequired ? (
                    <div className="flex flex-1 items-center justify-center">
                        <div className="w-full max-w-screen-sm px-4">
                            <AppSplashScreen />
                        </div>
                    </div>
                ) : isPendingCurrentUser &&
                  currentApp?.showLoginLoadingSpinner ? (
                    <div className="flex-1">
                        <Loading />
                    </div>
                ) : (
                    <Outlet />
                )}
            </SidebarInset>
        </SidebarProvider>
    );
};
