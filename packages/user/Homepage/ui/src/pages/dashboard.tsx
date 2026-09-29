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
        <div className="flex flex-col gap-8">
            <div className="grid-bg -mx-4 -mt-4 flex flex-col gap-8 px-4 pb-2 pt-5 md:-mx-6 md:-mt-6 md:px-6 md:pt-8">
                <WelcomeBanner />
                {isPending ? (
                    <div className="flex items-center gap-5">
                        <Skeleton className="size-24 rounded-2xl" />
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
                    <div className="grid gap-6 xl:grid-cols-3">
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
