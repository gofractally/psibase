import { Outlet, useNavigate } from "react-router-dom";

import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar";

import { AppSidebar } from "@/components/app-sidebar";

import { useNavLocation } from "@/hooks/use-nav-location";

import { LoadingBox } from "./apps/chainmail/components/empty-states";
import {
    Card,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "./components/ui/card";
import { useCurrentUser } from "./hooks/use-current-user";
import { LoginButton } from "./login-button";

const SplashScreen = () => {
    const { currentApp } = useNavLocation();

    return (
        <div className="mx-auto mt-4 w-[350px]">
            {/* Main app info card */}
            <Card className="rounded-b-none border-b-0 shadow-sm">
                <CardHeader>
                    <div className="mx-auto">{currentApp?.icon}</div>
                    <CardTitle>{currentApp?.name}</CardTitle>
                    <CardDescription>{currentApp?.description}</CardDescription>
                </CardHeader>
            </Card>

            {/* Login prompt card */}
            <Card className="rounded-t-none border-t-0 bg-muted/50">
                <CardHeader className="pb-2 pt-4">
                    <CardDescription className="text-center font-medium">
                        {`Please log in to access ${currentApp?.name}`}
                    </CardDescription>
                </CardHeader>
                <CardFooter className="flex justify-center pb-4">
                    <LoginButton />
                </CardFooter>
            </Card>
        </div>
    );
};

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
                            <SplashScreen />
                        </div>
                    </div>
                ) : isPendingCurrentUser &&
                  currentApp?.showLoginLoadingSpinner ? (
                    <div className="flex-1">
                        <LoadingBox />
                    </div>
                ) : (
                    <Outlet />
                )}
            </SidebarInset>
        </SidebarProvider>
    );
};
