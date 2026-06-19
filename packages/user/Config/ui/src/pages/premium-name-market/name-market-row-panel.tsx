import type {
    PremiumNameMarketFormRow,
    PremiumNameMarketsFormValues,
} from "@/lib/premium-name-market-form";
import type { AnyFieldMeta } from "@tanstack/react-form";
import type { ReactNode } from "react";

import { PREMIUM_MARKET_DEFAULT_PARAMS } from "@/lib/premium-name-market-defaults";

import { FieldErrors } from "@shared/components/form/internal/field-errors";
import { cn } from "@shared/lib/utils";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

const MARKET_FIELD_PLACEHOLDERS = {
    initialPrice: PREMIUM_MARKET_DEFAULT_PARAMS.initialPrice,
    floorPrice: PREMIUM_MARKET_DEFAULT_PARAMS.floorPrice,
    target: String(PREMIUM_MARKET_DEFAULT_PARAMS.target),
    increasePpm: String(PREMIUM_MARKET_DEFAULT_PARAMS.increasePercent),
    decreasePpm: String(PREMIUM_MARKET_DEFAULT_PARAMS.decreasePercent),
} as const;

type MarketFormApi = {
    Field: (props: {
        name: string;
        children: (field: {
            state: {
                value: string;
                meta: {
                    errors: unknown[];
                    isTouched: boolean;
                };
            };
            handleChange: (value: string) => void;
            handleBlur: () => void;
        }) => ReactNode;
    }) => ReactNode;
    Subscribe: (props: {
        selector: (state: { values: PremiumNameMarketsFormValues }) => unknown;
        children: (value: unknown) => ReactNode;
    }) => ReactNode;
};

export type NameMarketRowPanelProps = {
    form: MarketFormApi;
    index: number;
    baseline: PremiumNameMarketFormRow;
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
    isDirty,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
    disabled?: boolean;
    placeholder?: string;
    inputMode?: "numeric" | "text";
    meta: { errors: unknown[]; isTouched: boolean };
    isDirty?: boolean;
}) {
    const isError = meta.errors.length > 0 && meta.isTouched;

    return (
        <div className="grid gap-1">
            <Label htmlFor={id} className="text-xs font-medium leading-none">
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

export function NameMarketRowPanel({
    form,
    index,
    baseline,
    actionsDisabled,
}: NameMarketRowPanelProps) {
    const baseName = `markets[${index}]` as const;

    return (
        <form.Subscribe
            selector={(state) => state.values.markets[index]?.configured}
        >
            {(configured) => (
                <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
                                isDirty={
                                    field.state.value !== baseline.initialPrice
                                }
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
                                isDirty={
                                    field.state.value !== baseline.floorPrice
                                }
                            />
                        )}
                    </form.Field>

                    <form.Field name={`${baseName}.target`}>
                        {(field) => (
                            <CompactField
                                id={`pm-target-${index}`}
                                label="Target sales / month"
                                value={field.state.value}
                                onChange={field.handleChange}
                                onBlur={field.handleBlur}
                                disabled={actionsDisabled}
                                inputMode="numeric"
                                placeholder={MARKET_FIELD_PLACEHOLDERS.target}
                                meta={field.state.meta}
                                isDirty={field.state.value !== baseline.target}
                            />
                        )}
                    </form.Field>

                    <form.Field name={`${baseName}.increasePpm`}>
                        {(field) => (
                            <CompactField
                                id={`pm-inc-ppm-${index}`}
                                label="% increase"
                                value={field.state.value}
                                onChange={field.handleChange}
                                onBlur={field.handleBlur}
                                disabled={actionsDisabled}
                                inputMode="numeric"
                                placeholder={
                                    MARKET_FIELD_PLACEHOLDERS.increasePpm
                                }
                                meta={field.state.meta}
                                isDirty={
                                    field.state.value !== baseline.increasePpm
                                }
                            />
                        )}
                    </form.Field>

                    <form.Field name={`${baseName}.decreasePpm`}>
                        {(field) => (
                            <CompactField
                                id={`pm-dec-ppm-${index}`}
                                label="% decrease"
                                value={field.state.value}
                                onChange={field.handleChange}
                                onBlur={field.handleBlur}
                                disabled={actionsDisabled}
                                inputMode="numeric"
                                placeholder={
                                    MARKET_FIELD_PLACEHOLDERS.decreasePpm
                                }
                                meta={field.state.meta}
                                isDirty={
                                    field.state.value !== baseline.decreasePpm
                                }
                            />
                        )}
                    </form.Field>
                </div>
            )}
        </form.Subscribe>
    );
}
