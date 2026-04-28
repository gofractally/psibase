import { useEffect, useMemo, useState } from "react";

import { useBillingConfig } from "@shared/hooks/use-billing-config";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useSystemToken } from "@shared/hooks/use-system-token";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import {
    useFillGasTank,
    useResizeAndFillGasTank,
} from "../hooks/use-fill-gas-tank";
import { useUserResources } from "../hooks/use-user-resources";
import { GasTank } from "./gas-tank";

export const UserSettingsSection = () => {
    const { data: currentUser } = useCurrentUser();
    const { data: billingConfig, isLoading: isLoadingBillingConfig } =
        useBillingConfig();
    const billingInited =
        !isLoadingBillingConfig && !!billingConfig?.feeReceiver;
    const { data: systemToken, isLoading: isLoadingToken } = useSystemToken();
    const {
        data: userResources,
        isLoading: isLoadingResources,
        isError: isUserResourcesError,
        error: userResourcesError,
    } = useUserResources(currentUser, { enabled: billingInited });
    const { mutateAsync: fillGasTank, isPending: isFilling } = useFillGasTank();
    const {
        mutateAsync: resizeAndFillGasTank,
        isPending: isResizingAndFilling,
    } = useResizeAndFillGasTank();

    const tokenSymbol = systemToken?.symbol;

    const fillPercentage = useMemo(() => {
        if (!userResources || userResources.bufferCapacity === 0) {
            return 0;
        }

        const ratio = userResources.balance / userResources.bufferCapacity;
        const thresholdPercent = userResources.autoFillThresholdPercent / 100;

        if (ratio <= thresholdPercent) {
            return 0;
        }

        const scaledRatio = (ratio - thresholdPercent) / (1 - thresholdPercent);
        return Math.max(0, Math.min(100, scaledRatio * 100));
    }, [userResources]);

    const originalCapacity = useMemo(() => {
        if (!userResources) {
            return "0";
        }
        return String(userResources.bufferCapacity);
    }, [userResources]);

    const [tankCapacityInput, setTankCapacityInput] =
        useState(originalCapacity);

    useEffect(() => {
        setTankCapacityInput(originalCapacity);
    }, [originalCapacity]);

    const capacityModified =
        tankCapacityInput !== originalCapacity && tankCapacityInput !== "";

    const isPending = isFilling || isResizingAndFilling;

    const handleRefill = async () => {
        try {
            if (capacityModified) {
                await resizeAndFillGasTank(tankCapacityInput);
            } else {
                await fillGasTank();
            }
        } catch {
            // Error is already handled by the mutation's onError
        }
    };

    const isDisabled = !billingInited || isPending || isLoadingResources;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="mb-2 text-2xl font-bold">Resources</h2>
            </div>

            <div className="flex items-stretch gap-6">
                <div className="flex flex-shrink-0">
                    <GasTank fillPercentage={fillPercentage} />
                </div>
                <div className="flex flex-col justify-between">
                    <div className="space-y-2">
                        <Label htmlFor="tank-capacity">Tank capacity</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="tank-capacity"
                                type="number"
                                value={tankCapacityInput}
                                onChange={(e) =>
                                    setTankCapacityInput(e.target.value)
                                }
                                className="w-24"
                                min="0"
                                step="any"
                                disabled={isDisabled}
                            />
                            <span className="text-muted-foreground">
                                {isLoadingToken ? "..." : tokenSymbol}
                            </span>
                        </div>
                    </div>

                    <Button
                        className="w-full"
                        onClick={handleRefill}
                        disabled={isDisabled}
                    >
                        {isPending
                            ? capacityModified
                                ? "Resizing & Refilling..."
                                : "Refilling..."
                            : "Refill"}
                    </Button>
                    {isUserResourcesError && (
                        <div className="text-destructive text-sm">
                            {userResourcesError?.message}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
