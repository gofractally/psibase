import { getAppPath } from "@/app-config";
import { Fragment } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { AccountSheet } from "@/components/account-sheet";
import { AppSplashScreen } from "@/components/app-splash-screen";
import { Loading } from "@/components/loading";
import { TopBarActions } from "@/components/top-bar";

import { useNavLocation } from "@/hooks/use-nav-location";

import { NetworkLogo } from "@shared/components/network-logo";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@shared/shadcn/ui/breadcrumb";

/** Labels for top-level routes that are not configured apps. */
const PAGE_LABELS: Record<string, string> = {
    invite: "Invitation",
    "invite-response": "Invitation",
};

const useCrumbs = () => {
    const { pathname } = useLocation();
    const { currentApp, currentChild } = useNavLocation();
    const crumbs: { label: string; to?: string }[] = [];

    if (currentApp) {
        const appPath = `/${getAppPath(currentApp)}`;
        const hasChildCrumb =
            currentChild &&
            currentChild.path !== "" &&
            currentApp.children.length > 1;
        crumbs.push({
            label: currentApp.name,
            to: hasChildCrumb ? appPath : undefined,
        });
        if (hasChildCrumb) {
            crumbs.push({ label: currentChild.name });
        }
        return crumbs;
    }

    const [section] = pathname.split("/").filter(Boolean);
    if (section && PAGE_LABELS[section]) {
        crumbs.push({ label: PAGE_LABELS[section] });
    }
    return crumbs;
};

const Crumbs = () => {
    const crumbs = useCrumbs();
    if (!crumbs.length) return null;

    return (
        <Breadcrumb className="min-w-0 overflow-hidden">
            <BreadcrumbList className="flex-nowrap">
                {crumbs.map((c, i) => (
                    <Fragment key={i}>
                        <BreadcrumbSeparator className="shrink-0" />
                        <BreadcrumbItem
                            className={c.to ? "shrink-0" : "min-w-0"}
                        >
                            {c.to ? (
                                <BreadcrumbLink asChild>
                                    <Link to={c.to}>{c.label}</Link>
                                </BreadcrumbLink>
                            ) : (
                                <BreadcrumbPage className="min-w-0 truncate">
                                    {c.label}
                                </BreadcrumbPage>
                            )}
                        </BreadcrumbItem>
                    </Fragment>
                ))}
            </BreadcrumbList>
        </Breadcrumb>
    );
};

export const Layout = () => {
    const { currentApp } = useNavLocation();
    const { data: currentUser, isPending: isPendingCurrentUser } =
        useCurrentUser();

    const isLoginRequired =
        !!currentApp && !currentUser && !isPendingCurrentUser;
    const isFill = currentApp?.fill === true && !isLoginRequired;

    return (
        <div className="flex h-svh flex-col overflow-hidden">
            <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 z-20 flex h-14 shrink-0 items-center gap-1 border-b px-2 backdrop-blur md:px-4">
                <Link to="/" aria-label="Home" className="shrink-0">
                    <NetworkLogo role={undefined} />
                </Link>
                <Crumbs />
                <div className="ml-auto shrink-0 pl-2">
                    <TopBarActions />
                </div>
            </header>

            {isLoginRequired ? (
                <div className="grid-bg flex flex-1 items-center justify-center p-4">
                    <AppSplashScreen />
                </div>
            ) : currentApp && isPendingCurrentUser ? (
                <Loading className="flex-1" />
            ) : isFill ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <Outlet />
                </div>
            ) : (
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
                    <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 p-4 md:p-6">
                        <Outlet />
                    </div>
                </div>
            )}
            <AccountSheet />
        </div>
    );
};
