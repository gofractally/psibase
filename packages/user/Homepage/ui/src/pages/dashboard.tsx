import { AppCards } from "@/components/home/app-cards";
import { GuestHero, PassportHero } from "@/components/home/passport-hero";
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

            {!isPending && <AppCards signedIn={!!user} />}
        </div>
    );
};

export default Dashboard;
