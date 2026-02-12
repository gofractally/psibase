import { useFractal } from "@/hooks/fractals/use-fractal";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useMembership } from "@/hooks/fractals/use-membership";

import { ErrorCard } from "@shared/components/error-card";
import { useChainId } from "@shared/hooks/use-chain-id";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { ConsensusRewardCard } from "../overview/components/consensus-reward-card";
import { JoinFractalCard } from "../overview/components/join-fractal-card";
import { OverviewCard } from "../overview/components/overview-card";

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

    const {
        data: chainId,
        isLoading: isLoadingChainId,
        error: errorChainId,
    } = useChainId();

    const isLoading =
        isLoadingCurrentUser ||
        isLoadingFractal ||
        isLoadingMembership ||
        isLoadingChainId;

    const error =
        errorCurrentUser || errorFractal || errorMembership || errorChainId;

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <div className="mx-auto w-full max-w-5xl p-4 px-6">
            <div className="mt-3 space-y-6">
                {isLoading || !chainId ? (
                    <>
                        <Skeleton className="h-48 w-full rounded-xl" />
                        <Skeleton className="h-48 w-full rounded-xl" />
                    </>
                ) : (
                    <>
                        <OverviewCard
                            fractal={fractal}
                            fractalAccount={fractalAccount}
                            chainId={chainId}
                            membership={membership}
                        />
                        <ConsensusRewardCard />
                        {membership == null && (
                            <JoinFractalCard fractalAccount={fractalAccount} />
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
