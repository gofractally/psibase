import { BuyForm } from "@/apps/prem-accounts/components/buy-form";

import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { usePremPrices } from "@shared/hooks/use-prem-prices";
import { useSystemToken } from "@shared/hooks/use-system-token";
import { MAX_ACCOUNT_NAME_LENGTH } from "@shared/lib/schemas/account";
import {
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const BuyPage = () => {
    const {
        data: systemToken,
        isSuccess: hasLoadedToken,
        isPending: isPendingToken,
    } = useSystemToken();

    const {
        data: prices,
        isSuccess: hasLoadedPrices,
        isPending: isPendingPrices,
    } = usePremPrices();

    const isLoading = isPendingToken || isPendingPrices;

    if (hasLoadedToken && !systemToken) {
        return (
            <ErrorCard
                title="Not available"
                error={
                    new Error(
                        "Account Marketplace is not available on networks without a system token.",
                    )
                }
            />
        );
    }

    if (hasLoadedPrices && !prices.size) {
        return (
            <ErrorCard
                title="Not available"
                error={
                    new Error(
                        "Buying names via Account Marketplace is currently disabled.",
                    )
                }
            />
        );
    }

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>Buy a premium account name</CardTitle>
                <CardDescription>
                    Account names can be up to {MAX_ACCOUNT_NAME_LENGTH}{" "}
                    characters long, must start with a letter, and can only
                    contain letters, numbers, and underscores.
                </CardDescription>
            </CardHeader>
            {isLoading ? (
                <CardContent className="space-y-4">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                </CardContent>
            ) : systemToken && prices ? (
                <BuyForm systemToken={systemToken} prices={prices} />
            ) : null}
        </GlowingCard>
    );
};
