import { useEffect, useMemo, useState } from "react";

import { useCurrentUser } from "@/hooks/use-current-user";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { toast } from "@shared/shadcn/ui/sonner";

import {
    useFillGasTank,
    useResizeAndFillGasTank,
} from "../hooks/use-fill-gas-tank";
import { useSystemToken } from "../hooks/use-system-token";
import { useUserResources } from "../hooks/use-user-resources";
import { GasTank } from "./gas-tank";

export const UserSettingsSection = () => {
    const { data: currentUser } = useCurrentUser();
    const { data: userResources, isLoading: isLoadingResources } =
        useUserResources(currentUser);
    const { data: systemToken, isLoading: isLoadingToken } = useSystemToken();
    const { mutateAsync: fillGasTank, isPending: isFilling } = useFillGasTank();
    const {
        mutateAsync: resizeAndFillGasTank,
        isPending: isResizingAndFilling,
    } = useResizeAndFillGasTank();

    const tokenSymbol = systemToken?.symbol || "$SYS";

    const fillPercentage = useMemo(() => {
        if (!userResources || userResources.bufferCapacityRaw === 0) {
            return 0;
        }

        const ratio = userResources.balanceRaw / userResources.bufferCapacityRaw;
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

    const [tankCapacityInput, setTankCapacityInput] = useState(originalCapacity);

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
                                value={tankCapacityInput}
                                onChange={(e) =>
                                    setTankCapacityInput(e.target.value)
                                }
                                className="w-24"
                                min="0"
                                step="any"
                                disabled={isPending || isLoadingResources}
                            />
                            <span className="text-muted-foreground">
                                {isLoadingToken ? "..." : tokenSymbol}
                            </span>
                        </div>
                    </div>

                    <Button
                        className="w-full"
                        onClick={handleRefill}
                        disabled={isPending || isLoadingResources}
                    >
                        {isPending
                            ? capacityModified
                                ? "Resizing & Refilling..."
                                : "Refilling..."
                            : "Refill"}
                    </Button>
                </div>
            </div>
        </div>
    );
};
