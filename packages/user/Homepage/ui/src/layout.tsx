import { Link, Outlet } from "react-router-dom";

import { AccountSheet } from "@/components/account-sheet";
import { AppSplashScreen } from "@/components/app-splash-screen";
import { Loading } from "@/components/loading";
import { TopBarActions } from "@/components/top-bar";

import { useNavLocation } from "@/hooks/use-nav-location";

import { NetworkLogo } from "@shared/components/network-logo";
import { useCurrentUser } from "@shared/hooks/use-current-user";

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
