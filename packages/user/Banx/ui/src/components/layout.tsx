import { Link, Outlet, useLocation } from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";

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

const titles: Record<string, string> = {
    "/accounts": "Accounts",
    "/network": "Network",
    "/requests": "Requests",
    "/payees": "Payees",
    "/cash": "Cash",
    "/policies": "Swaps",
    "/invites": "Invites",
    "/invite": "Invite",
};

export const Layout = () => {
    const { pathname } = useLocation();
    // The network canvas used to sit in normal flow. Lock this route to the
    // viewport so a resize measurement cannot grow the document.
    const network = pathname === "/network";
    const accountMatch = pathname.match(/^\/accounts\/([^/]+)$/);
    const accountName = accountMatch
        ? decodeURIComponent(accountMatch[1])
        : null;
    const page = accountName
        ? accountName
        : (titles[pathname] ?? "Banx");

    return (
        <SidebarProvider
            className={network ? "h-svh overflow-hidden" : undefined}
        >
            <AppSidebar variant="inset" />
            <SidebarInset className={network ? "min-h-0" : undefined}>
                <header className="flex h-14 shrink-0 items-center gap-2 transition-[width,height] ease-linear sm:h-16 group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
                    <div className="flex items-center gap-2 px-3 sm:px-4">
                        <SidebarTrigger className="-ml-1" />
                        <Separator
                            orientation="vertical"
                            className="mr-2 h-4"
                        />
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem className="hidden md:block">
                                    <BreadcrumbLink asChild>
                                        <Link to="/accounts">Banx</Link>
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator className="hidden md:block" />
                                {accountName ? (
                                    <>
                                        <BreadcrumbItem>
                                            <BreadcrumbLink asChild>
                                                <Link to="/accounts">
                                                    Accounts
                                                </Link>
                                            </BreadcrumbLink>
                                        </BreadcrumbItem>
                                        <BreadcrumbSeparator />
                                        <BreadcrumbItem>
                                            <BreadcrumbPage>
                                                {accountName}
                                            </BreadcrumbPage>
                                        </BreadcrumbItem>
                                    </>
                                ) : (
                                    <BreadcrumbItem>
                                        <BreadcrumbPage>{page}</BreadcrumbPage>
                                    </BreadcrumbItem>
                                )}
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>
                </header>
                <div
                    className={`mx-auto flex w-full flex-1 flex-col gap-4 p-3 sm:p-4 ${
                        network
                            ? "min-h-0 max-w-none overflow-y-auto"
                            : "max-w-screen-xl"
                    }`}
                >
                    <Outlet />
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
};
