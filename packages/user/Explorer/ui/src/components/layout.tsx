import { Fragment } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { shortHash } from "@/lib/format";

import { AppSidebar } from "@/components/app-sidebar";
import { GlobalSearch } from "@/components/global-search";
import { LiveIndicator } from "@/components/live-indicator";

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

const SECTION_LABELS: Record<string, string> = {
    blocks: "Blocks",
    transactions: "Transactions",
    tx: "Transactions",
    producers: "Producers",
    services: "Services",
    network: "Network",
    accounts: "Accounts",
    search: "Search",
};

const SECTION_LINKS: Record<string, string> = {
    tx: "/transactions",
    accounts: "/services",
};

const useCrumbs = () => {
    const { pathname } = useLocation();
    const segments = pathname.split("/").filter(Boolean);
    const crumbs: { label: string; to?: string }[] = [];
    if (segments.length === 0) return crumbs;
    const [section, ...rest] = segments;
    const sectionLabel = SECTION_LABELS[section] ?? section;
    const sectionTo = SECTION_LINKS[section] ?? `/${section}`;
    crumbs.push({ label: sectionLabel, to: rest.length ? sectionTo : undefined });
    if (rest.length) {
        const leaf = decodeURIComponent(rest.join("/"));
        crumbs.push({
            label:
                section === "tx"
                    ? shortHash(leaf, 8, 8)
                    : section === "blocks"
                      ? `#${leaf}`
                      : leaf,
        });
    }
    return crumbs;
};

export const Layout = () => {
    const crumbs = useCrumbs();
    return (
        <SidebarProvider>
            <AppSidebar variant="inset" />
            <SidebarInset className="min-w-0">
                <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="mr-1 h-4" />
                    <Breadcrumb className="hidden min-w-0 md:block">
                        <BreadcrumbList className="flex-nowrap">
                            <BreadcrumbItem>
                                {crumbs.length ? (
                                    <BreadcrumbLink asChild>
                                        <Link to="/">Explorer</Link>
                                    </BreadcrumbLink>
                                ) : (
                                    <BreadcrumbPage>Explorer</BreadcrumbPage>
                                )}
                            </BreadcrumbItem>
                            {crumbs.map((c, i) => (
                                <Fragment key={i}>
                                    <BreadcrumbSeparator />
                                    <BreadcrumbItem className="min-w-0">
                                        {c.to ? (
                                            <BreadcrumbLink asChild>
                                                <Link to={c.to}>{c.label}</Link>
                                            </BreadcrumbLink>
                                        ) : (
                                            <BreadcrumbPage className="truncate font-mono">
                                                {c.label}
                                            </BreadcrumbPage>
                                        )}
                                    </BreadcrumbItem>
                                </Fragment>
                            ))}
                        </BreadcrumbList>
                    </Breadcrumb>
                    <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 md:flex-none">
                        <GlobalSearch className="w-full max-w-[420px] md:w-[360px] lg:w-[420px]" />
                        <LiveIndicator />
                    </div>
                </header>
                <div className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-4 p-4 md:p-6">
                    <Outlet />
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
};
