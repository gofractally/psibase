import { useEffect, useMemo } from "react";

import { Label } from "@shared/shadcn/ui/label";
import { useAppForm } from "@shared/components/form/app-form";
import { useSetCpuPricingParams } from "@/hooks/use-set-cpu-pricing-params";
import { useSetNetPricingParams } from "@/hooks/use-set-net-pricing-params";
import {
    type RateTimeUnit,
    getBestRateTimeUnit,
    convertRateTimeUnit,
    TIME_FACTORS,
} from "@/lib/unit-conversions";
import type { CpuPricing, NetPricing } from "@/hooks/use-resource-pricing";
import { TimeUnitSelect } from "@/components/unit-select";

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

const DEFAULT_FORM_VALUES: PricingFormValues = {
    halvingTimeUnit: "sec",
    halvingTimeValue: "",
    doublingTimeUnit: "sec",
    doublingTimeValue: "",
    idleThreshold: "",
    congestedThreshold: "",
    averageWindowSize: "",
    billableUnit: "",
};

function getInitialFormValues(
    pricing: CpuPricing | NetPricing,
    isCpu: boolean,
): PricingFormValues {
    const halvingSec = Number(pricing.halvingTimeSec) || 0;
    const doublingSec = Number(pricing.doublingTimeSec) || 0;
    const initialHalving = getBestRateTimeUnit(halvingSec);
    const initialDoubling = getBestRateTimeUnit(doublingSec);
    const billableUnitValue = isCpu
        ? (Number(pricing.billableUnit) || 0) / TIME_FACTORS.ms
        : (Number(pricing.billableUnit) || 0) / 8;
    return {
        halvingTimeUnit: initialHalving.unit,
        halvingTimeValue: convertRateTimeUnit(
            halvingSec,
            "sec",
            initialHalving.unit,
        ).toString(),
        doublingTimeUnit: initialDoubling.unit,
        doublingTimeValue: convertRateTimeUnit(
            doublingSec,
            "sec",
            initialDoubling.unit,
        ).toString(),
        idleThreshold: Math.round(parseFloat(pricing.thresholds.idlePct) || 0).toString(),
        congestedThreshold: Math.round(
            parseFloat(pricing.thresholds.congestedPct) || 0,
        ).toString(),
        averageWindowSize: String(Number(pricing.numBlocksToAverage) || 0),
        billableUnit: Number.isFinite(billableUnitValue)
            ? billableUnitValue.toString()
            : "0",
    };
}

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

    const defaultValues = useMemo<PricingFormValues>(() => {
        if (!pricing) return DEFAULT_FORM_VALUES;
        return getInitialFormValues(pricing, isCpu);
    }, [pricing, isCpu]);

    const { mutateAsync: setCpuPricingParams } = useSetCpuPricingParams();
    const { mutateAsync: setNetPricingParams } = useSetNetPricingParams();

    const pricingForm = useAppForm({
        defaultValues,
        onSubmit: async (data: { value: PricingFormValues }) => {
            if (!pricing) return;

            const formValues = data.value;

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

            pricingForm.reset(data.value);
        },
    });

    useEffect(() => {
        if (pricing) {
            const values = getInitialFormValues(pricing, isCpu);
            console.info("[PricingSection] useEffect reset with", {
                halvingTimeValue: values.halvingTimeValue,
                doublingTimeValue: values.doublingTimeValue,
                halvingTimeUnit: values.halvingTimeUnit,
                doublingTimeUnit: values.doublingTimeUnit,
            });
            pricingForm.reset(values);
        }
    }, [pricing, isCpu]);

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

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    pricingForm.handleSubmit();
                }}
            >
                <pricingForm.AppForm>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <pricingForm.AppField name="halvingTimeValue">
                            {(valueField) => (
                                <pricingForm.AppField name="halvingTimeUnit">
                                    {(unitField) => (
                                        <div>
                                            <Label>Halving rate</Label>
                                            <div className="mt-1 flex items-center gap-2">
                                                <valueField.TextField
                                                    label={undefined}
                                                    description={undefined}
                                                    className="w-36"
                                                />
                                                <div className="mt-2">
                                                    <TimeUnitSelect
                                                        value={unitField.state.value}
                                                        onChange={(newUnit) => {
                                                            const val =
                                                                Number(
                                                                    valueField.state.value,
                                                                ) || 0;
                                                            const oldUnit =
                                                                unitField.state.value;
                                                            const inSec =
                                                                convertRateTimeUnit(
                                                                    val,
                                                                    oldUnit,
                                                                    "sec",
                                                                );
                                                            const newVal =
                                                                convertRateTimeUnit(
                                                                    inSec,
                                                                    "sec",
                                                                    newUnit,
                                                                );
                                                            unitField.handleChange(
                                                                newUnit,
                                                            );
                                                            valueField.handleChange(
                                                                newVal.toString(),
                                                            );
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </pricingForm.AppField>
                            )}
                        </pricingForm.AppField>

                        <pricingForm.AppField name="doublingTimeValue">
                            {(valueField) => (
                                <pricingForm.AppField name="doublingTimeUnit">
                                    {(unitField) => (
                                        <div>
                                            <Label>Doubling rate</Label>
                                            <div className="mt-1 flex items-center gap-2">
                                                <valueField.TextField
                                                    label={undefined}
                                                    description={undefined}
                                                    className="w-36"
                                                />
                                                <div className="mt-2">
                                                    <TimeUnitSelect
                                                        value={unitField.state.value}
                                                        onChange={(newUnit) => {
                                                            const val =
                                                                Number(
                                                                    valueField.state.value,
                                                                ) || 0;
                                                            const oldUnit =
                                                                unitField.state.value;
                                                            const inSec =
                                                                convertRateTimeUnit(
                                                                    val,
                                                                    oldUnit,
                                                                    "sec",
                                                                );
                                                            const newVal =
                                                                convertRateTimeUnit(
                                                                    inSec,
                                                                    "sec",
                                                                    newUnit,
                                                                );
                                                            unitField.handleChange(
                                                                newUnit,
                                                            );
                                                            valueField.handleChange(
                                                                newVal.toString(),
                                                            );
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </pricingForm.AppField>
                            )}
                        </pricingForm.AppField>

                        <pricingForm.AppField name="idleThreshold">
                            {(field) => (
                                <field.TextField
                                    label="Idle threshold"
                                    endContent={
                                        <span className="text-muted-foreground text-sm">
                                            %
                                        </span>
                                    }
                                    className="w-36"
                                />
                            )}
                        </pricingForm.AppField>

                        <pricingForm.AppField name="congestedThreshold">
                            {(field) => (
                                <field.TextField
                                    label="Congested threshold"
                                    endContent={
                                        <span className="text-muted-foreground text-sm">
                                            %
                                        </span>
                                    }
                                    className="w-36"
                                />
                            )}
                        </pricingForm.AppField>

                        <pricingForm.AppField name="averageWindowSize">
                            {(field) => (
                                <field.TextField
                                    label="Average window size"
                                    endContent={
                                        <span className="text-muted-foreground text-sm">
                                            blocks
                                        </span>
                                    }
                                    className="w-36"
                                />
                            )}
                        </pricingForm.AppField>

                        <pricingForm.AppField name="billableUnit">
                            {(field) => (
                                <field.TextField
                                    label="Minimum billable unit"
                                    endContent={
                                        <span className="text-muted-foreground text-sm">
                                            {billableUnitLabel}
                                        </span>
                                    }
                                    className="w-36"
                                />
                            )}
                        </pricingForm.AppField>
                    </div>

                    <div className="mt-4 flex justify-end">
                        <pricingForm.SubmitButton
                            labels={["Save", "Saving..."]}
                            disabled={!pricing}
                        />
                    </div>
                </pricingForm.AppForm>
            </form>
        </div>
    );
};
