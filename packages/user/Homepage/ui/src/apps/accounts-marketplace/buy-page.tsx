import { Ban } from "lucide-react";
import { useMemo } from "react";

import { AccountMarketsCard } from "@/apps/accounts-marketplace/components/account-markets-card";
import { BuyForm } from "@/apps/accounts-marketplace/components/buy-form";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/page-header";

import {
    ACCOUNT_MARKETS_REFETCH_INTERVAL_MS,
    useAccountMarkets,
} from "@shared/hooks/use-account-markets";
import { useCanBuyAccount } from "@shared/hooks/use-can-buy-account";
import { useSystemToken } from "@shared/hooks/use-system-token";
import { MAX_ACCOUNT_NAME_LENGTH } from "@shared/lib/schemas/account";
import { accountMarketPricesFromOverview } from "@shared/lib/schemas/account-markets";
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
            <Panel title="Not available">
                <EmptyState
                    icon={Ban}
                    className="min-h-40"
                    detail="Buying names via the Account Marketplace is currently disabled on this network."
                >
                    Purchases are disabled
                </EmptyState>
            </Panel>
        );
    }

    return (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Panel
                title="Buy an account name"
                description={`Up to ${MAX_ACCOUNT_NAME_LENGTH} characters; must start with a letter and contain only letters, numbers and underscores.`}
                className="self-start"
            >
                {isLoading ? (
                    <Loader />
                ) : canBuyAccount && systemToken && prices ? (
                    <BuyForm systemToken={systemToken} prices={prices} />
                ) : null}
            </Panel>
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
        <div className="flex flex-col gap-4 p-4">
            <div className="space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-9 w-full" />
            </div>
            <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-8 w-20" />
            </div>
        </div>
    );
};
