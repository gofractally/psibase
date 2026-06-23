import { useMemo } from "react";

import { BuyForm } from "@/apps/prem-accounts/components/buy-form";
import { AccountMarketsCard } from "@/apps/prem-accounts/components/premium-markets-card";

import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { useCanBuyAccount } from "@shared/hooks/use-can-create-premium-account";
import {
    ACCOUNT_MARKETS_REFETCH_INTERVAL_MS,
    useAccountMarkets,
} from "@shared/hooks/use-prem-markets";
import { useSystemToken } from "@shared/hooks/use-system-token";
import { MAX_ACCOUNT_NAME_LENGTH } from "@shared/lib/schemas/account";
import { accountMarketPricesFromOverview } from "@shared/lib/schemas/prem-accounts";
import {
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const BuyPage = () => {
    const { data: systemToken, isPending: isPendingToken } = useSystemToken();
    const {
        data: markets,
        isPending: isPendingMarkets,
        isError: isMarketsError,
        error: marketsError,
    } = useAccountMarkets({
        refetchInterval: ACCOUNT_MARKETS_REFETCH_INTERVAL_MS,
    });

    const prices = useMemo(
        () => (markets ? accountMarketPricesFromOverview(markets) : undefined),
        [markets],
    );

    const { data: canBuyAccount, isPending: isPendingCanBuyAccount } =
        useCanBuyAccount();

    const isLoading =
        isPendingToken || isPendingMarkets || isPendingCanBuyAccount;

    if (canBuyAccount === false) {
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
        <div className="space-y-6">
            <GlowingCard>
                <CardHeader>
                    <CardTitle>Buy an account name</CardTitle>
                    <CardDescription>
                        Account names can be up to {MAX_ACCOUNT_NAME_LENGTH}{" "}
                        characters long, must start with a letter, and can only
                        contain letters, numbers, and underscores.
                    </CardDescription>
                </CardHeader>
                {isLoading ? (
                    <Loader />
                ) : canBuyAccount && systemToken && prices ? (
                    <BuyForm systemToken={systemToken} prices={prices} />
                ) : null}
            </GlowingCard>
            <AccountMarketsCard
                markets={markets}
                systemToken={systemToken}
                isPending={isPendingToken || isPendingMarkets}
                isError={isMarketsError}
                error={marketsError}
            />
        </div>
    );
};

const Loader = () => {
    return (
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
    );
};
