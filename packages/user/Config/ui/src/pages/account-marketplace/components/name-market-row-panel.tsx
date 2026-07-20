import type { NameMarketsFormValues } from "@/lib/name-market-form";
import type { AnyFieldMeta } from "@tanstack/react-form";
import type { ReactNode } from "react";

import { NAME_MARKET_DEFAULT_PARAMS } from "@/lib/name-market-defaults";

import { FieldErrors } from "@shared/components/form/internal/field-errors";
import {
    type DurationUnit,
    zDurationUnit,
} from "@shared/lib/schemas/duration-unit";
import { cn } from "@shared/lib/utils";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

const MARKET_FIELD_PLACEHOLDERS = {
    initialPrice: NAME_MARKET_DEFAULT_PARAMS.initialPrice,
    floorPrice: NAME_MARKET_DEFAULT_PARAMS.floorPrice,
    windowAmount: NAME_MARKET_DEFAULT_PARAMS.windowAmount,
    target: String(NAME_MARKET_DEFAULT_PARAMS.target),
    increasePct: String(NAME_MARKET_DEFAULT_PARAMS.increasePercent),
    decreasePct: String(NAME_MARKET_DEFAULT_PARAMS.decreasePercent),
} as const;

const FIELD_LABEL_CLASS = "text-xs font-medium leading-none min-h-3.5";

const WINDOW_UNIT_LABELS: Record<DurationUnit, string> = {
    Minutes: "Min",
    Hours: "Hours",
    Days: "Days",
};

type MarketFormApi = {
    Field: (props: {
        name: string;
        children: (field: {
            state: {
                value: string;
                meta: {
                    errors: unknown[];
                    isDefaultValue: boolean;
                };
            };
            handleChange: (value: string) => void;
            handleBlur: () => void;
        }) => ReactNode;
    }) => ReactNode;
    Subscribe: (props: {
        selector: (state: { values: NameMarketsFormValues }) => unknown;
        children: (value: unknown) => ReactNode;
    }) => ReactNode;
};

export type NameMarketRowPanelProps = {
    form: MarketFormApi;
    index: number;
    actionsDisabled: boolean;
};

function CompactField({
    id,
    label,
    value,
    onChange,
    onBlur,
    disabled,
    placeholder,
    inputMode,
    meta,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
    disabled?: boolean;
    placeholder?: string;
    inputMode?: "numeric" | "text";
    meta: {
        errors: unknown[];
        isDefaultValue: boolean;
    };
}) {
    const isDirty = !meta.isDefaultValue;
    const isError = meta.errors.length > 0;

    return (
        <div className="grid min-w-0 gap-1">
            <Label
                htmlFor={id}
                className={FIELD_LABEL_CLASS}
            >
                {label}
            </Label>
            <Input
                id={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onBlur={onBlur}
                autoComplete="off"
                inputMode={inputMode}
                disabled={disabled}
                placeholder={placeholder}
                className={cn(
                    "h-8 scroll-mt-28 font-mono text-sm",
                    isDirty &&
                    !isError &&
                    "border-amber-300 ring-2 ring-amber-400/50 dark:border-amber-700 dark:ring-amber-500/40",
                )}
                aria-invalid={isError}
            />
            <FieldErrors meta={meta as AnyFieldMeta} />
        </div>
    );
}

function WindowLengthField({
    id,
    amount,
    unit,
    onAmountChange,
    onUnitChange,
    onAmountBlur,
    disabled,
    meta,
    isDirty,
}: {
    id: string;
    amount: string;
    unit: DurationUnit;
    onAmountChange: (value: string) => void;
    onUnitChange: (value: DurationUnit) => void;
    onAmountBlur: () => void;
    disabled?: boolean;
    meta: {
        errors: unknown[];
    };
    isDirty?: boolean;
}) {
    const isError = meta.errors.length > 0;
    const dirtyRingClass =
        isDirty && !isError
            ? "border-amber-300 ring-2 ring-amber-400/50 dark:border-amber-700 dark:ring-amber-500/40"
            : undefined;

    return (
        <div className="grid min-w-0 gap-1">
            <Label htmlFor={id} className={FIELD_LABEL_CLASS}>
                Window length
            </Label>
            <div className="flex items-center gap-2">
                <Input
                    id={id}
                    value={amount}
                    onChange={(e) => onAmountChange(e.target.value)}
                    onBlur={onAmountBlur}
                    autoComplete="off"
                    inputMode="numeric"
                    disabled={disabled}
                    placeholder={MARKET_FIELD_PLACEHOLDERS.windowAmount}
                    className={cn(
                        "h-8 min-w-0 flex-1 scroll-mt-28 font-mono text-sm",
                        dirtyRingClass,
                    )}
                    aria-invalid={isError}
                />
                <Select
                    value={unit}
                    onValueChange={(value) =>
                        onUnitChange(value as DurationUnit)
                    }
                    disabled={disabled}
                >
                    <SelectTrigger
                        size="sm"
                        className={cn(
                            "w-24 shrink-0 font-mono text-sm",
                            dirtyRingClass,
                        )}
                        aria-label="Window length unit"
                    >
                        <SelectValue placeholder="Days">
                            {WINDOW_UNIT_LABELS[unit]}
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                        {zDurationUnit.options.map((option) => (
                            <SelectItem key={option} value={option}>
                                {WINDOW_UNIT_LABELS[option]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <FieldErrors meta={meta as AnyFieldMeta} />
        </div>
    );
}

export function NameMarketRowPanel({
    form,
    index,
    actionsDisabled,
}: NameMarketRowPanelProps) {
    const baseName = `markets[${index}]` as const;

    return (
        <form.Subscribe
            selector={(state) => state.values.markets[index]?.configured}
        >
            {(configured) => (
                <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.45fr)_minmax(0,1fr)_4.75rem_4.75rem]">
                    <form.Field name={`${baseName}.initialPrice`}>
                        {(field) => (
                            <CompactField
                                id={`pm-initial-${index}`}
                                label="Initial price"
                                value={field.state.value}
                                onChange={field.handleChange}
                                onBlur={field.handleBlur}
                                disabled={
                                    actionsDisabled || configured === true
                                }
                                placeholder={
                                    configured
                                        ? "Fixed at creation"
                                        : MARKET_FIELD_PLACEHOLDERS.initialPrice
                                }
                                meta={field.state.meta}
                            />
                        )}
                    </form.Field>

                    <form.Field name={`${baseName}.floorPrice`}>
                        {(field) => (
                            <CompactField
                                id={`pm-floor-${index}`}
                                label="Floor price"
                                value={field.state.value}
                                onChange={field.handleChange}
                                onBlur={field.handleBlur}
                                disabled={actionsDisabled}
                                placeholder={
                                    MARKET_FIELD_PLACEHOLDERS.floorPrice
                                }
                                meta={field.state.meta}
                            />
                        )}
                    </form.Field>

                    <form.Field name={`${baseName}.windowAmount`}>
                        {(amountField) => (
                            <form.Field name={`${baseName}.windowUnit`}>
                                {(unitField) => (
                                    <WindowLengthField
                                        id={`pm-window-${index}`}
                                        amount={amountField.state.value}
                                        unit={
                                            unitField.state
                                                .value as DurationUnit
                                        }
                                        onAmountChange={
                                            amountField.handleChange
                                        }
                                        onUnitChange={unitField.handleChange}
                                        onAmountBlur={amountField.handleBlur}
                                        disabled={actionsDisabled}
                                        meta={amountField.state.meta}
                                        isDirty={
                                            !amountField.state.meta
                                                .isDefaultValue ||
                                            !unitField.state.meta
                                                .isDefaultValue
                                        }
                                    />
                                )}
                            </form.Field>
                        )}
                    </form.Field>

                    <form.Field name={`${baseName}.target`}>
                        {(field) => (
                            <CompactField
                                id={`pm-target-${index}`}
                                label="Target sales / window"
                                value={field.state.value}
                                onChange={field.handleChange}
                                onBlur={field.handleBlur}
                                disabled={actionsDisabled}
                                inputMode="numeric"
                                placeholder={MARKET_FIELD_PLACEHOLDERS.target}
                                meta={field.state.meta}
                            />
                        )}
                    </form.Field>

                    <form.Field name={`${baseName}.increasePct`}>
                        {(field) => (
                            <CompactField
                                id={`pm-inc-pct-${index}`}
                                label="% increase"
                                value={field.state.value}
                                onChange={field.handleChange}
                                onBlur={field.handleBlur}
                                disabled={actionsDisabled}
                                inputMode="numeric"
                                placeholder={
                                    MARKET_FIELD_PLACEHOLDERS.increasePct
                                }
                                meta={field.state.meta}
                            />
                        )}
                    </form.Field>

                    <form.Field name={`${baseName}.decreasePct`}>
                        {(field) => (
                            <CompactField
                                id={`pm-dec-pct-${index}`}
                                label="% decrease"
                                value={field.state.value}
                                onChange={field.handleChange}
                                onBlur={field.handleBlur}
                                disabled={actionsDisabled}
                                inputMode="numeric"
                                placeholder={
                                    MARKET_FIELD_PLACEHOLDERS.decreasePct
                                }
                                meta={field.state.meta}
                            />
                        )}
                    </form.Field>
                </div>
            )}
        </form.Subscribe>
    );
}