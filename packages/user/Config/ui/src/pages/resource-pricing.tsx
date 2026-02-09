import { useEffect, useState } from "react";
import { Button } from "@shared/shadcn/ui/button";
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
import { useSetCpuPricingParams } from "@/hooks/use-set-cpu-pricing-params";
import { useSetNetPricingParams } from "@/hooks/use-set-net-pricing-params";
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
    const isCpu = title === "CPU Pricing";

    const [halvingTimeUnit, setHalvingTimeUnit] = useState<RateTimeUnit>("sec");
    const [doublingTimeUnit, setDoublingTimeUnit] = useState<RateTimeUnit>("sec");
    const [halvingTimeValue, setHalvingTimeValue] = useState<string>("");
    const [doublingTimeValue, setDoublingTimeValue] = useState<string>("");
    const [idleThreshold, setIdleThreshold] = useState<string>("");
    const [congestedThreshold, setCongestedThreshold] = useState<string>("");
    const [averageWindowSize, setAverageWindowSize] = useState<string>("");
    const [billableUnit, setBillableUnit] = useState<string>("");

    const {
        mutateAsync: setCpuPricingParams,
        isPending: isSavingCpu,
    } = useSetCpuPricingParams();
    const {
        mutateAsync: setNetPricingParams,
        isPending: isSavingNet,
    } = useSetNetPricingParams();

    useEffect(() => {
        if (!pricing) {
            return;
        }

        const initialHalving = getBestRateTimeUnit(pricing.halvingTimeSec);
        const initialDoubling = getBestRateTimeUnit(pricing.doublingTimeSec);

        setHalvingTimeUnit(initialHalving.unit);
        setDoublingTimeUnit(initialDoubling.unit);

        setHalvingTimeValue(
            convertRateTimeUnit(
                pricing.halvingTimeSec,
                "sec",
                initialHalving.unit,
            ).toString(),
        );
        setDoublingTimeValue(
            convertRateTimeUnit(
                pricing.doublingTimeSec,
                "sec",
                initialDoubling.unit,
            ).toString(),
        );

        setIdleThreshold(
            Math.round(parseFloat(pricing.thresholds.idlePct)).toString(),
        );
        setCongestedThreshold(
            Math.round(parseFloat(pricing.thresholds.congestedPct)).toString(),
        );
        setAverageWindowSize(pricing.numBlocksToAverage.toString());

        const billableUnitValue = isCpu
            ? pricing.billableUnit / TIME_FACTORS.ms
            : pricing.billableUnit / 8;
        setBillableUnit(billableUnitValue.toString());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pricing]);

    const isSaving = isCpu ? isSavingCpu : isSavingNet;

    const handleSave = async () => {
        if (!pricing) return;

        const halvingTimeSec = convertRateTimeUnit(
            Number(halvingTimeValue) || 0,
            halvingTimeUnit,
            "sec",
        );
        const doublingTimeSec = convertRateTimeUnit(
            Number(doublingTimeValue) || 0,
            doublingTimeUnit,
            "sec",
        );

        const idlePct = (idleThreshold || "0").trim();
        const congestedPct = (congestedThreshold || "0").trim();
        const numBlocksToAverage = Number(averageWindowSize) || 0;

        if (isCpu) {
            const minBillableUnitNs = Math.floor(
                (Number(billableUnit) || 0) * TIME_FACTORS.ms,
            );

            await setCpuPricingParams([
                {
                    idlePct,
                    congestedPct,
                    halvingTimeSec: Math.round(halvingTimeSec),
                    doublingTimeSec: Math.round(doublingTimeSec),
                    numBlocksToAverage,
                    minBillableUnitNs,
                },
            ]);
        } else {
            const minBillableUnitBits = Math.floor(
                (Number(billableUnit) || 0) * 8,
            );

            await setNetPricingParams([
                {
                    idlePct,
                    congestedPct,
                    halvingTimeSec: Math.round(halvingTimeSec),
                    doublingTimeSec: Math.round(doublingTimeSec),
                    numBlocksToAverage,
                    minBillableUnitBits,
                },
            ]);
        }
    };

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
                            value={halvingTimeValue}
                            onChange={(e) => setHalvingTimeValue(e.target.value)}
                            className="w-36"
                        />
                        <Select
                            value={halvingTimeUnit}
                            onValueChange={(value) => {
                                const newUnit = value as RateTimeUnit;
                                const currentValue =
                                    Number(halvingTimeValue) || 0;
                                const valueInSec = convertRateTimeUnit(
                                    currentValue,
                                    halvingTimeUnit,
                                    "sec",
                                );
                                const newValue = convertRateTimeUnit(
                                    valueInSec,
                                    "sec",
                                    newUnit,
                                );

                                setHalvingTimeUnit(newUnit);
                                setHalvingTimeValue(newValue.toString());
                            }}
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
                            value={doublingTimeValue}
                            onChange={(e) =>
                                setDoublingTimeValue(e.target.value)
                            }
                            className="w-36"
                        />
                        <Select
                            value={doublingTimeUnit}
                            onValueChange={(value) => {
                                const newUnit = value as RateTimeUnit;
                                const currentValue =
                                    Number(doublingTimeValue) || 0;
                                const valueInSec = convertRateTimeUnit(
                                    currentValue,
                                    doublingTimeUnit,
                                    "sec",
                                );
                                const newValue = convertRateTimeUnit(
                                    valueInSec,
                                    "sec",
                                    newUnit,
                                );

                                setDoublingTimeUnit(newUnit);
                                setDoublingTimeValue(newValue.toString());
                            }}
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
                            value={idleThreshold}
                            onChange={(e) =>
                                setIdleThreshold(e.target.value)
                            }
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
                            value={congestedThreshold}
                            onChange={(e) =>
                                setCongestedThreshold(e.target.value)
                            }
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
                            value={averageWindowSize}
                            onChange={(e) =>
                                setAverageWindowSize(e.target.value)
                            }
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
                            value={billableUnit}
                            onChange={(e) => setBillableUnit(e.target.value)}
                            className="w-36"
                        />
                        <span className="text-sm text-muted-foreground">{billableUnitLabel}</span>
                    </div>
                </div>
            </div>
            <div className="mt-4 flex justify-end">
                <Button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving || !pricing}
                >
                    Save
                </Button>
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
                    View and configure CPU and network resource pricing parameters.
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
