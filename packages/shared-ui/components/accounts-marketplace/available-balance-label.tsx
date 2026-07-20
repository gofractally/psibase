import type { SystemTokenInfo } from "@shared/hooks/use-system-token";

import type { Quantity } from "@shared/lib/quantity";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export function AvailableBalanceLabel({
    systemToken,
    balance,
    isPending,
}: {
    systemToken: SystemTokenInfo;
    balance: Quantity | undefined;
    isPending: boolean;
}) {
    if (isPending) {
        return <Skeleton className="h-4 w-40" />;
    }

    const formattedBalance =
        balance?.format({ includeLabel: true }) ?? `0 ${systemToken.symbol}`;

    return (
        <p className="text-muted-foreground text-sm tabular-nums">
            Available balance:{" "}
            <span className="text-foreground/90 font-medium">
                {formattedBalance}
            </span>
        </p>
    );
}
