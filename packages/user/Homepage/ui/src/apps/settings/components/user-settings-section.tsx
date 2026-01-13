import { useMemo } from "react";

import { useCurrentUser } from "@/hooks/use-current-user";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { toast } from "@shared/shadcn/ui/sonner";

import { useFillGasTank } from "../hooks/use-fill-gas-tank";
import { useSystemToken } from "../hooks/use-system-token";
import { useUserResources } from "../hooks/use-user-resources";
import { GasTank } from "./gas-tank";

export const UserSettingsSection = () => {
    const { data: currentUser } = useCurrentUser();
    const { data: userResources, isLoading: isLoadingResources } =
        useUserResources(currentUser);
    const { data: systemToken, isLoading: isLoadingToken } = useSystemToken();
    const { mutateAsync: fillGasTank, isPending: isFilling } = useFillGasTank();

    const tokenSymbol = systemToken?.symbol || "$SYS";

    // Calculate fill percentage accounting for auto_fill_threshold_percent reserve
    // When balanceRaw/bufferCapacityRaw = threshold%, tank should show as 0%
    // When balanceRaw/bufferCapacityRaw = 1.0 (100%), tank should show as 100%
    // Formula: fillPercentage = ((balanceRaw/bufferCapacityRaw) - threshold) / (1 - threshold) * 100
    const fillPercentage = useMemo(() => {
        if (!userResources || userResources.bufferCapacityRaw === 0) {
            return 0;
        }

        // Verify we're using balanceRaw and bufferCapacityRaw for calculations
        const ratio = userResources.balanceRaw / userResources.bufferCapacityRaw;
        const thresholdPercent = userResources.autoFillThresholdPercent / 100;

        // If at or below threshold, show as empty
        if (ratio <= thresholdPercent) {
            return 0;
        }

        // Scale from threshold% to 100% to 0% to 100% display
        const scaledRatio = (ratio - thresholdPercent) / (1 - thresholdPercent);
        return Math.max(0, Math.min(100, scaledRatio * 100));
    }, [userResources]);

    // Calculate tank capacity for display (bufferCapacityRaw converted to token amount)
    const tankCapacity = useMemo(() => {
        if (!userResources || !systemToken) {
            return "0";
        }
        return userResources.bufferCapacity;
    }, [userResources, systemToken]);

    const handleRefill = async () => {
        try {
            await fillGasTank();
        } catch (error) {
            // Error is already handled by the mutation's onError
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold mb-2">Settings</h2>
            </div>

            <div className="flex items-stretch gap-6">
                <div className="flex-shrink-0 flex">
                    <GasTank fillPercentage={fillPercentage} />
                </div>

                <div className="flex flex-col justify-between">
                    <div className="space-y-2">
                        <Label htmlFor="tank-capacity">Tank capacity</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="tank-capacity"
                                type="number"
                                value={tankCapacity}
                                readOnly
                                className="w-24"
                                min="0"
                            />
                            <span className="text-muted-foreground">
                                {isLoadingToken ? "..." : tokenSymbol}
                            </span>
                        </div>
                    </div>

                    <Button
                        className="w-full"
                        onClick={handleRefill}
                        disabled={isFilling || isLoadingResources}
                    >
                        {isFilling ? "Refilling..." : "Refill"}
                    </Button>
                </div>
            </div>
        </div>
    );
};
