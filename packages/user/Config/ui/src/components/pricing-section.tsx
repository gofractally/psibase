import { useEffect, useMemo, useState } from "react";
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
import type { CpuPricing, NetPricing } from "@/hooks/use-resource-pricing";

interface PricingFormValues {
    halvingTimeUnit: RateTimeUnit;
    halvingTimeValue: string;
    doublingTimeUnit: RateTimeUnit;
    doublingTimeValue: string;
    idleThreshold: string;
    congestedThreshold: string;
    averageWindowSize: string;
    billableUnit: string;
}

function getInitialFormValues(
    pricing: CpuPricing | NetPricing,
    isCpu: boolean,
): PricingFormValues {
    const initialHalving = getBestRateTimeUnit(pricing.halvingTimeSec);
    const initialDoubling = getBestRateTimeUnit(pricing.doublingTimeSec);
    const billableUnitValue = isCpu
        ? pricing.billableUnit / TIME_FACTORS.ms
        : pricing.billableUnit / 8;
    return {
        halvingTimeUnit: initialHalving.unit,
        halvingTimeValue: convertRateTimeUnit(
            pricing.halvingTimeSec,
            "sec",
            initialHalving.unit,
        ).toString(),
        doublingTimeUnit: initialDoubling.unit,
        doublingTimeValue: convertRateTimeUnit(
            pricing.doublingTimeSec,
            "sec",
            initialDoubling.unit,
        ).toString(),
        idleThreshold: Math.round(parseFloat(pricing.thresholds.idlePct)).toString(),
        congestedThreshold: Math.round(
            parseFloat(pricing.thresholds.congestedPct),
        ).toString(),
        averageWindowSize: pricing.numBlocksToAverage.toString(),
        billableUnit: billableUnitValue.toString(),
    };
}

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

    const initialValues = useMemo<PricingFormValues | null>(() => {
        if (!pricing) return null;
        return getInitialFormValues(pricing, isCpu);
    }, [pricing, isCpu]);

    const [edits, setEdits] = useState<Partial<PricingFormValues>>({});
    useEffect(() => {
        setEdits({});
    }, [pricing]);

    const formValues: PricingFormValues = useMemo(() => {
        const base = initialValues ?? {
            halvingTimeUnit: "sec" as RateTimeUnit,
            halvingTimeValue: "",
            doublingTimeUnit: "sec" as RateTimeUnit,
            doublingTimeValue: "",
            idleThreshold: "",
            congestedThreshold: "",
            averageWindowSize: "",
            billableUnit: "",
        };
        return { ...base, ...edits };
    }, [initialValues, edits]);

    const {
        mutateAsync: setCpuPricingParams,
        isPending: isSavingCpu,
    } = useSetCpuPricingParams();
    const {
        mutateAsync: setNetPricingParams,
        isPending: isSavingNet,
    } = useSetNetPricingParams();

    const isSaving = isCpu ? isSavingCpu : isSavingNet;

    const updateEdit = <K extends keyof PricingFormValues>(
        key: K,
        value: PricingFormValues[K],
    ) => setEdits((prev) => ({ ...prev, [key]: value }));

    const handleSave = async () => {
        if (!pricing) return;

        const halvingTimeSec = convertRateTimeUnit(
            Number(formValues.halvingTimeValue) || 0,
            formValues.halvingTimeUnit,
            "sec",
        );
        const doublingTimeSec = convertRateTimeUnit(
            Number(formValues.doublingTimeValue) || 0,
            formValues.doublingTimeUnit,
            "sec",
        );

        const idlePct = (formValues.idleThreshold || "0").trim();
        const congestedPct = (formValues.congestedThreshold || "0").trim();
        const numBlocksToAverage = Number(formValues.averageWindowSize) || 0;

        if (isCpu) {
            const minBillableUnitNs = Math.floor(
                (Number(formValues.billableUnit) || 0) * TIME_FACTORS.ms,
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
                (Number(formValues.billableUnit) || 0) * 8,
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
            Number(formValues.halvingTimeValue) || 0,
            formValues.halvingTimeUnit,
            "sec",
        );
        const newValue = convertRateTimeUnit(valueInSec, "sec", newUnit);
        setEdits((prev) => ({
            ...prev,
            halvingTimeUnit: newUnit,
            halvingTimeValue: newValue.toString(),
        }));
    };
    const handleDoublingUnitChange = (newUnit: RateTimeUnit) => {
        const valueInSec = convertRateTimeUnit(
            Number(formValues.doublingTimeValue) || 0,
            formValues.doublingTimeUnit,
            "sec",
        );
        const newValue = convertRateTimeUnit(valueInSec, "sec", newUnit);
        setEdits((prev) => ({
            ...prev,
            doublingTimeUnit: newUnit,
            doublingTimeValue: newValue.toString(),
        }));
    };

    return (
        <div className="rounded-lg border p-4">
            <div className="mb-4">
                <h3 className="text-base font-medium">{title}</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RateTimeField
                    label="Halving rate"
                    value={formValues.halvingTimeValue}
                    unit={formValues.halvingTimeUnit}
                    onValueChange={(v) => updateEdit("halvingTimeValue", v)}
                    onUnitChange={handleHalvingUnitChange}
                />
                <RateTimeField
                    label="Doubling rate"
                    value={formValues.doublingTimeValue}
                    unit={formValues.doublingTimeUnit}
                    onValueChange={(v) => updateEdit("doublingTimeValue", v)}
                    onUnitChange={handleDoublingUnitChange}
                />
                <ThresholdField
                    label="Idle threshold"
                    value={formValues.idleThreshold}
                    onChange={(v) => updateEdit("idleThreshold", v)}
                />
                <ThresholdField
                    label="Congested threshold"
                    value={formValues.congestedThreshold}
                    onChange={(v) => updateEdit("congestedThreshold", v)}
                />
                <LabeledInputField
                    label="Average window size"
                    value={formValues.averageWindowSize}
                    onChange={(v) => updateEdit("averageWindowSize", v)}
                    suffix="blocks"
                />
                <LabeledInputField
                    label="Minimum billable unit"
                    value={formValues.billableUnit}
                    onChange={(v) => updateEdit("billableUnit", v)}
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
