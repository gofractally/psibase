import { useFractal } from "@/hooks/fractals/use-fractal";
import { useMembership } from "@/hooks/fractals/use-membership";
import { useCurrentFractal } from "@/hooks/use-current-fractal";

import { ErrorCard } from "@shared/components/error-card";
import { OverviewCard } from "@shared/domains/fractal/components/fractal-overview-card";
import { PageContainer } from "@shared/domains/fractal/components/page-container";
import { useChainId } from "@shared/hooks/use-chain-id";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const MyMembership = () => {
    const fractalAccount = useCurrentFractal();

    const {
        data: currentUser,
        isLoading: isLoadingCurrentUser,
        error: errorCurrentUser,
    } = useCurrentUser();

    const {
        data: fractal,
        isLoading: isLoadingFractal,
        error: errorFractal,
    } = useFractal(fractalAccount);

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
        <PageContainer className="space-y-6">
            {isLoading || !chainId ? (
                <Skeleton className="h-48 w-full rounded-xl" />
            ) : (
                <OverviewCard
                    fractal={fractal}
                    fractalAccount={fractalAccount}
                    membership={membership}
                    linksToFractal={true}
                />
            )}
        </PageContainer>
    );
};
