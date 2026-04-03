import { useFractal } from "@/hooks/fractals/use-fractal";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useMembership } from "@/hooks/fractals/use-membership";

import { ErrorCard } from "@shared/components/error-card";
import { OverviewCard } from "@shared/domains/fractal/components/fractal-overview-card";
import { PageContainer } from "@shared/domains/fractal/components/page-container";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { ConsensusRewardCard } from "../overview/components/consensus-reward-card";
import { JoinFractalCard } from "../overview/components/join-fractal-card";

export const Overview = () => {
    const fractalAccount = useFractalAccount();

    const {
        data: currentUser,
        isLoading: isLoadingCurrentUser,
        error: errorCurrentUser,
    } = useCurrentUser();

    const {
        data: fractal,
        isLoading: isLoadingFractal,
        error: errorFractal,
    } = useFractal();

    const {
        data: membership,
        isLoading: isLoadingMembership,
        error: errorMembership,
    } = useMembership(fractalAccount, currentUser);

    const isLoading =
        isLoadingCurrentUser || isLoadingFractal || isLoadingMembership;

    const error = errorCurrentUser || errorFractal || errorMembership;

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <PageContainer>
            <div className="space-y-6">
                {isLoading ? (
                    <>
                        <Skeleton className="h-48 w-full rounded-xl" />
                        <Skeleton className="h-48 w-full rounded-xl" />
                    </>
                ) : (
                    <>
                        <OverviewCard
                            fractal={fractal}
                            fractalAccount={fractalAccount}
                            membership={membership}
                        />
                        <ConsensusRewardCard />
                        {membership == null && (
                            <JoinFractalCard fractalAccount={fractalAccount} />
                        )}
                    </>
                )}
            </div>
        </PageContainer>
    );
};
