import { Link, Outlet, useLocation, useParams } from "react-router-dom";

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

export const Layout = () => {
    const location = useLocation();
    const { owner, id, groupNumber } = useParams();

    const isHome =
        location.pathname === "/" || location.pathname === "";
    const isGroupPage = groupNumber != null && owner != null && id != null;
    const isEvaluationPage =
        !isHome && owner != null && id != null && groupNumber == null;

    return (
        <SidebarProvider>
            <AppSidebar variant="inset" />
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
                                <BreadcrumbItem className="hidden md:block">
                                    <BreadcrumbLink asChild>
                                        <Link to="/">Evaluations</Link>
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                {isHome ? (
                                    <>
                                        <BreadcrumbSeparator className="hidden md:block" />
                                        <BreadcrumbItem>
                                            <BreadcrumbPage>Home</BreadcrumbPage>
                                        </BreadcrumbItem>
                                    </>
                                ) : null}
                                {isEvaluationPage ? (
                                    <>
                                        <BreadcrumbSeparator className="hidden md:block" />
                                        <BreadcrumbItem>
                                            <BreadcrumbPage>
                                                Evaluation{" "}
                                                <span className="text-muted-foreground font-normal">
                                                    {owner}/{id}
                                                </span>
                                            </BreadcrumbPage>
                                        </BreadcrumbItem>
                                    </>
                                ) : null}
                                {isGroupPage ? (
                                    <>
                                        <BreadcrumbSeparator className="hidden md:block" />
                                        <BreadcrumbItem className="hidden md:block">
                                            <BreadcrumbLink asChild>
                                                <Link to={`/${owner}/${id}`}>
                                                    Evaluation{" "}
                                                    <span className="text-muted-foreground font-normal">
                                                        {owner}/{id}
                                                    </span>
                                                </Link>
                                            </BreadcrumbLink>
                                        </BreadcrumbItem>
                                        <BreadcrumbSeparator className="hidden md:block" />
                                        <BreadcrumbItem>
                                            <BreadcrumbPage>
                                                Group {groupNumber}
                                            </BreadcrumbPage>
                                        </BreadcrumbItem>
                                    </>
                                ) : null}
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>
                </header>
                <div className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-4 p-4">
                    <Outlet />
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
};
