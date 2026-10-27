import { AppCards, AppCardsSkeleton } from "@/components/home/app-cards";
import { DashboardSection } from "@/components/home/dashboard-section";
import {
    MostActiveApps,
    MostActiveAppsSkeleton,
} from "@/components/home/most-active-apps";
import { NetworkStats } from "@/components/home/network-cards";
import { OwnedOnNetwork } from "@/components/home/owned-on-network";
import { GuestHero, PassportHero } from "@/components/home/passport-hero";
import { WelcomeBanner } from "@/components/welcome-banner";

import { useExplorerInstalled } from "@/hooks/use-explorer-chain";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const Dashboard = () => {
    const { data: user, isPending } = useCurrentUser();
    const explorerInstalled = useExplorerInstalled();
    const explorerPending = explorerInstalled === undefined;
    const showExplorer = explorerInstalled !== false;
    const leaderboard =
        showExplorer &&
        (explorerPending ? <MostActiveAppsSkeleton /> : <MostActiveApps />);

    return (
        <div className="flex flex-col gap-8">
            <div className="grid-bg -mx-4 -mt-4 flex flex-col gap-8 px-4 pb-2 pt-5 md:-mx-6 md:-mt-6 md:px-6 md:pt-8">
                <WelcomeBanner />
                {isPending ? (
                    <div className="flex items-center gap-5">
                        <Skeleton className="size-24 rounded-full" />
                        <div className="flex flex-col gap-2">
                            <Skeleton className="h-3 w-40" />
                            <Skeleton className="h-8 w-64" />
                        </div>
                    </div>
                ) : user ? (
                    <PassportHero user={user} />
                ) : (
                    <GuestHero />
                )}
            </div>

            {isPending ? <AppCardsSkeleton /> : <AppCards signedIn={!!user} />}

            {(showExplorer || user) && (
                <DashboardSection title="Network">
                    <div
                        className={cn(
                            "grid gap-4",
                            showExplorer && "lg:grid-cols-2",
                        )}
                    >
                        <div className="flex flex-col gap-4">
                            {showExplorer && (
                                <NetworkStats
                                    user={user}
                                    isPending={explorerPending}
                                />
                            )}
                            {user ? <OwnedOnNetwork user={user} /> : leaderboard}
                        </div>
                        {user && leaderboard}
                    </div>
                </DashboardSection>
            )}
        </div>
    );
};

export default Dashboard;
