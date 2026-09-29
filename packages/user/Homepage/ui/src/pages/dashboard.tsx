import { EverywhereStats } from "@/components/home/everywhere-stats";
import { HowItWorks } from "@/components/home/how-it-works";
import { LatestChats } from "@/components/home/latest-chats";
import { GuestHero, PassportHero } from "@/components/home/passport-hero";
import { WalletWidget } from "@/components/home/wallet-widget";
import { WelcomeBanner } from "@/components/welcome-banner";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const Dashboard = () => {
    const { data: user, isPending } = useCurrentUser();

    return (
        <div className="flex flex-col gap-5">
            <div className="grid-bg -mx-4 -mt-4 flex flex-col gap-5 px-4 pb-1 pt-4 md:-mx-6 md:-mt-6 md:px-6 md:pt-6">
                <WelcomeBanner />
                {isPending ? (
                    <div className="flex items-center gap-4">
                        <Skeleton className="size-20 rounded-2xl" />
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

            {user ? (
                <>
                    <EverywhereStats user={user} />
                    <div className="grid gap-4 xl:grid-cols-3">
                        <LatestChats className="xl:col-span-2" />
                        <WalletWidget user={user} />
                    </div>
                </>
            ) : (
                !isPending && <HowItWorks />
            )}
        </div>
    );
};

export default Dashboard;
