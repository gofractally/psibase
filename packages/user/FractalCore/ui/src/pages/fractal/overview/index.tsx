import { PageContainer } from "@/components/page-container";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";

import { ErrorCard } from "@shared/components/error-card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { ConsensusRewardCard } from "../overview/components/consensus-reward-card";
import { OverviewCard } from "../overview/components/overview-card";

export const Overview = () => {
    const fractalAccount = useFractalAccount();

    const {
        data: fractal,
        isLoading,
        error,
    } = useFractal();

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
                        />
                        <ConsensusRewardCard />
                    </>
                )}
            </div>
        </PageContainer>
    );
};
