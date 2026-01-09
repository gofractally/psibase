import { useEffect, useMemo, useState } from "react";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";
import { useCpuPricing, type CpuPricing } from "@/hooks/use-cpu-pricing";
import { useNetPricing, type NetPricing } from "@/hooks/use-net-pricing";
import {
    type RateTimeUnit,
    getBestRateTimeUnit,
    convertRateTimeUnit,
    TIME_FACTORS,
} from "@/lib/unit-conversions";

interface PricingSectionProps {
    title: string;
    pricing: CpuPricing | NetPricing | undefined;
    isLoading: boolean;
    billableUnitLabel: string;
}

const PricingSection = ({ title, pricing, isLoading, billableUnitLabel }: PricingSectionProps) => {
    const [halvingTimeUnit, setHalvingTimeUnit] = useState<RateTimeUnit>("sec");
    const [doublingTimeUnit, setDoublingTimeUnit] = useState<RateTimeUnit>("sec");

    useEffect(() => {
        if (pricing && halvingTimeUnit === "sec" && doublingTimeUnit === "sec") {
            const initialHalving = getBestRateTimeUnit(pricing.halvingTimeSec);
            const initialDoubling = getBestRateTimeUnit(pricing.doublingTimeSec);
            
            setHalvingTimeUnit(initialHalving.unit);
            setDoublingTimeUnit(initialDoubling.unit);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pricing]);

    const computedValues = useMemo(() => {
        if (!pricing) {
            return {
                halvingTime: { value: 0, unit: "sec" as RateTimeUnit },
                doublingTime: { value: 0, unit: "sec" as RateTimeUnit },
                idleThreshold: "",
                congestedThreshold: "",
                averageWindowSize: "",
                billableUnit: "",
            };
        }

        const halvingTime = {
            value: convertRateTimeUnit(
                pricing.halvingTimeSec,
                "sec",
                halvingTimeUnit,
            ),
            unit: halvingTimeUnit,
        };
        
        const doublingTime = {
            value: convertRateTimeUnit(
                pricing.doublingTimeSec,
                "sec",
                doublingTimeUnit,
            ),
            unit: doublingTimeUnit,
        };
        
        const billableUnitValue = title === "CPU Pricing" 
            ? pricing.billableUnit / TIME_FACTORS.ms
            : pricing.billableUnit / 8;

        return {
            halvingTime,
            doublingTime,
            idleThreshold: Math.round(parseFloat(pricing.thresholds.idlePct)).toString(),
            congestedThreshold: Math.round(parseFloat(pricing.thresholds.congestedPct)).toString(),
            averageWindowSize: pricing.numBlocksToAverage.toString(),
            billableUnit: billableUnitValue.toString(),
        };
    }, [pricing, title, halvingTimeUnit, doublingTimeUnit]);

    if (isLoading) {
        return (
            <div className="rounded-lg border p-4">
                <div className="mb-4">
                    <h3 className="text-base font-medium">{title}</h3>
                </div>
                <p className="text-muted-foreground text-sm">Loading...</p>
            </div>
        );
    }

    if (!pricing) {
        return (
            <div className="rounded-lg border p-4">
                <div className="mb-4">
                    <h3 className="text-base font-medium">{title}</h3>
                </div>
                <p className="text-muted-foreground text-sm">No pricing data available</p>
            </div>
        );
    }

    return (
        <div className="rounded-lg border p-4">
            <div className="mb-4">
                <h3 className="text-base font-medium">{title}</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <Label>Halving rate</Label>
                    <div className="mt-1 flex items-center gap-2">
                        <Input
                            type="text"
                            value={Math.round(computedValues.halvingTime.value).toString()}
                            readOnly
                            className="w-36"
                        />
                        <Select
                            value={computedValues.halvingTime.unit}
                            onValueChange={(value) => setHalvingTimeUnit(value as RateTimeUnit)}
                        >
                            <SelectTrigger className="w-24">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="sec">sec</SelectItem>
                                <SelectItem value="min">min</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div>
                    <Label>Doubling rate</Label>
                    <div className="mt-1 flex items-center gap-2">
                        <Input
                            type="text"
                            value={Math.round(computedValues.doublingTime.value).toString()}
                            readOnly
                            className="w-36"
                        />
                        <Select
                            value={computedValues.doublingTime.unit}
                            onValueChange={(value) => setDoublingTimeUnit(value as RateTimeUnit)}
                        >
                            <SelectTrigger className="w-24">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="sec">sec</SelectItem>
                                <SelectItem value="min">min</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div>
                    <Label>Idle threshold</Label>
                    <div className="mt-1 flex items-center gap-2">
                        <Input
                            type="text"
                            value={computedValues.idleThreshold}
                            readOnly
                            className="w-36"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                    </div>
                </div>
                <div>
                    <Label>Congested threshold</Label>
                    <div className="mt-1 flex items-center gap-2">
                        <Input
                            type="text"
                            value={computedValues.congestedThreshold}
                            readOnly
                            className="w-36"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                    </div>
                </div>
                <div>
                    <Label>Average window size</Label>
                    <div className="mt-1 flex items-center gap-2">
                        <Input
                            type="text"
                            value={computedValues.averageWindowSize}
                            readOnly
                            className="w-36"
                        />
                        <span className="text-sm text-muted-foreground">blocks</span>
                    </div>
                </div>
                <div>
                    <Label>Minimum billable unit</Label>
                    <div className="mt-1 flex items-center gap-2">
                        <Input
                            type="text"
                            value={computedValues.billableUnit}
                            readOnly
                            className="w-36"
                        />
                        <span className="text-sm text-muted-foreground">{billableUnitLabel}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const ResourcePricing = () => {
    const { data: cpuPricing, isLoading: cpuLoading } = useCpuPricing();
    const { data: netPricing, isLoading: netLoading } = useNetPricing();

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
            <div>
                <h2 className="text-lg font-medium">Resource Pricing</h2>
                <p className="text-muted-foreground text-sm">
                    View CPU and network resource pricing parameters.
                </p>
            </div>

            <div className="space-y-6">
                <PricingSection
                    title="CPU Pricing"
                    pricing={cpuPricing}
                    isLoading={cpuLoading}
                    billableUnitLabel="ms"
                />
                <PricingSection
                    title="NET Pricing"
                    pricing={netPricing}
                    isLoading={netLoading}
                    billableUnitLabel="bytes"
                />
            </div>
        </div>
    );
};
