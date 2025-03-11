import {
    Outlet,
    useNavigate,
    useParams,
    useMatch,
    useLocation,
} from "react-router-dom";
import { AppSidebar } from "@/components/app-sidebar";
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
import { useNavLocation } from "@/hooks/useNavLocation";

export const Layout = () => {
    const navigate = useNavigate();
    const { currentApp, currentChild } = useNavLocation();

    const primaryNavLabel = currentApp?.name ?? "Dashboard";
    const secondaryNavLabel = currentChild?.name;

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
                <Outlet />
            </SidebarInset>
        </SidebarProvider>
    );
};
