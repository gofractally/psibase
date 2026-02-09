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
import { useSetCpuPricingParams } from "@/hooks/use-set-cpu-pricing-params";
import { useSetNetPricingParams } from "@/hooks/use-set-net-pricing-params";
import {
    type RateTimeUnit,
    getBestRateTimeUnit,
    convertRateTimeUnit,
    TIME_FACTORS,
} from "@/lib/unit-conversions";
import type { CpuPricing } from "@/hooks/use-cpu-pricing";
import type { NetPricing } from "@/hooks/use-net-pricing";

const RateTimeField = ({
    label,
    value,
    unit,
    onValueChange,
    onUnitChange,
}: {
    label: string;
    value: string;
    unit: RateTimeUnit;
    onValueChange: (value: string) => void;
    onUnitChange: (unit: RateTimeUnit) => void;
}) => (
    <div>
        <Label>{label}</Label>
        <div className="mt-1 flex items-center gap-2">
            <Input
                type="text"
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                className="w-36"
            />
            <Select value={unit} onValueChange={(v) => onUnitChange(v as RateTimeUnit)}>
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
);

const ThresholdField = ({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) => (
    <div>
        <Label>{label}</Label>
        <div className="mt-1 flex items-center gap-2">
            <Input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="w-36" />
            <span className="text-sm text-muted-foreground">%</span>
        </div>
    </div>
);

const LabeledInputField = ({
    label,
    value,
    onChange,
    suffix,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    suffix: string;
}) => (
    <div>
        <Label>{label}</Label>
        <div className="mt-1 flex items-center gap-2">
            <Input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="w-36" />
            <span className="text-sm text-muted-foreground">{suffix}</span>
        </div>
    </div>
);

interface PricingSectionProps {
    title: string;
    pricing: CpuPricing | NetPricing | undefined;
    isLoading: boolean;
    billableUnitLabel: string;
}

export const PricingSection = ({
    title,
    pricing,
    isLoading,
    billableUnitLabel,
}: PricingSectionProps) => {
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

    const handleHalvingUnitChange = (newUnit: RateTimeUnit) => {
        const valueInSec = convertRateTimeUnit(
            Number(halvingTimeValue) || 0,
            halvingTimeUnit,
            "sec",
        );
        const newValue = convertRateTimeUnit(valueInSec, "sec", newUnit);
        setHalvingTimeUnit(newUnit);
        setHalvingTimeValue(newValue.toString());
    };
    const handleDoublingUnitChange = (newUnit: RateTimeUnit) => {
        const valueInSec = convertRateTimeUnit(
            Number(doublingTimeValue) || 0,
            doublingTimeUnit,
            "sec",
        );
        const newValue = convertRateTimeUnit(valueInSec, "sec", newUnit);
        setDoublingTimeUnit(newUnit);
        setDoublingTimeValue(newValue.toString());
    };

    return (
        <div className="rounded-lg border p-4">
            <div className="mb-4">
                <h3 className="text-base font-medium">{title}</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RateTimeField
                    label="Halving rate"
                    value={halvingTimeValue}
                    unit={halvingTimeUnit}
                    onValueChange={setHalvingTimeValue}
                    onUnitChange={handleHalvingUnitChange}
                />
                <RateTimeField
                    label="Doubling rate"
                    value={doublingTimeValue}
                    unit={doublingTimeUnit}
                    onValueChange={setDoublingTimeValue}
                    onUnitChange={handleDoublingUnitChange}
                />
                <ThresholdField
                    label="Idle threshold"
                    value={idleThreshold}
                    onChange={setIdleThreshold}
                />
                <ThresholdField
                    label="Congested threshold"
                    value={congestedThreshold}
                    onChange={setCongestedThreshold}
                />
                <LabeledInputField
                    label="Average window size"
                    value={averageWindowSize}
                    onChange={setAverageWindowSize}
                    suffix="blocks"
                />
                <LabeledInputField
                    label="Minimum billable unit"
                    value={billableUnit}
                    onChange={setBillableUnit}
                    suffix={billableUnitLabel}
                />
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
