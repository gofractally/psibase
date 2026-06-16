import type { PremiumNameMarketsFormValues } from "@/lib/premium-name-market-form";
import type { AnyFieldMeta } from "@tanstack/react-form";
import type { ReactNode } from "react";

import { FieldErrors } from "@shared/components/form/internal/field-errors";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

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
    meta: { errors: unknown[]; isTouched: boolean };
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
                className="h-8 font-mono text-sm"
                aria-invalid={isError}
            />
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
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <form.Subscribe
                selector={(state) => state.values.markets[index]?.configured}
            >
                {(configured) => (
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
                                    configured === true
                                        ? "Fixed at creation"
                                        : undefined
                                }
                                meta={field.state.meta}
                            />
                        )}
                    </form.Field>
                )}
            </form.Subscribe>

            <form.Field name={`${baseName}.floorPrice`}>
                {(field) => (
                    <CompactField
                        id={`pm-floor-${index}`}
                        label="Floor price"
                        value={field.state.value}
                        onChange={field.handleChange}
                        onBlur={field.handleBlur}
                        disabled={actionsDisabled}
                        meta={field.state.meta}
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
                        meta={field.state.meta}
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
                        meta={field.state.meta}
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
                        meta={field.state.meta}
                    />
                )}
            </form.Field>
        </div>
    );
}
