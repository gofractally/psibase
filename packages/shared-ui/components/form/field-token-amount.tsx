/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FieldValidators } from "@tanstack/react-form";

import { z } from "zod";

import { withFieldGroup } from "./app-form";

/**
 * A field for entering a token amount for use in a tanstack/react-form form
 * Because this uses the `withFieldGroup` HOC, this must be nested in the form's schema as a field group:
 *
 * ```tsx
 * const form = useAppForm({
 *     defaultValues: {
 *         to: "",
 *         amount: {
 *             amount: "", // must be nested
 *         },
 *     },
 *     validators: z.object({
 *         to: Account,
 *         amount: z.object({
 *             amount: z.string(), // field-level validation will run on top of this
 *         }),
 *     }),
 *     ...
 * });
 * ```
 *
 * Then consume the field like so:
 *
 * ```tsx
 * <TokenAmountField
 *     form={form}
 *     fields="amount"
 *     precision={precision}
 *     balance={balance}
 *     disabled={isDisabled}
 *     description={null}
 *     validators={{}}
 *     onMaxAmountClick={null}
 * />
 * ```
 *
 * @param precision - The precision of the token; null skips validation
 * @param balance - The balance of the token; null skips validation
 * @param disabled - Whether the field is disabled
 * @param description - Optional description text (specify null to ignore)
 * @param validators - Optional validators (specify `{}` to ignore)
 * @param onMaxAmountClick - Optional function to call when the max amount button is clicked; set to `null` to omit Max button
 * @returns A field for entering a token amount
 */
export const FieldTokenAmount = withFieldGroup({
    defaultValues: {
        amount: "",
    },
    props: {
        precision: null as number | null,
        balance: null as number | null,
        disabled: false,
        description: null as string | null,
        validators: {} as FieldValidators<
            any,
            any,
            any,
            any,
            any,
            any,
            any,
            any,
            any,
            any,
            any,
            any
        >,
        onMaxAmountClick: null as
            | ((e: React.MouseEvent<HTMLButtonElement>) => void)
            | null,
    },
    render: function Render({
        group,
        precision,
        balance,
        disabled,
        description,
        validators,
        onMaxAmountClick,
    }) {
        const p = (27.83658204756385).toFixed(precision ?? 0);

        const handleSetMaxAmount = (e: React.MouseEvent<HTMLButtonElement>) => {
            if (!onMaxAmountClick) return;
            e.preventDefault();
            onMaxAmountClick?.(e);
            group.validateField("amount", "change");
        };

        return (
            <div className="relative">
                {onMaxAmountClick && (
                    <button
                        className="absolute right-0 top-0 select-none text-sm leading-none opacity-50 hover:cursor-pointer disabled:hidden"
                        onClick={handleSetMaxAmount}
                        disabled={
                            disabled || balance === 0 || precision === undefined
                        }
                    >
                        Max
                    </button>
                )}
                <group.AppField
                    name="amount"
                    children={(field) => {
                        return (
                            <field.TextField
                                disabled={disabled || precision === undefined}
                                label="Amount"
                                placeholder={`e.g., ${p}`}
                                description={description ?? undefined}
                            />
                        );
                    }}
                    validators={
                        {
                            onChangeAsync: zTokenAmount({ precision, balance }), // doing this async ensures these values are not stale
                            ...validators,
                        } as any
                    }
                />
            </div>
        );
    },
});

const zTokenAmount = ({
    precision,
    balance,
}: {
    precision: number | null;
    balance: number | null;
}) => {
    return z
        .string()
        .min(1, "Required")
        .refine((val) => {
            if (!/^\d*\.?\d*$/.test(val)) {
                return false; // Check basic number format
            }
            const num = Number(val);
            if (isNaN(num) || num <= 0) {
                return false; // Check if it's zero or negative
            }
            return true;
        }, "Must be a positive number")
        .refine((val) => {
            if (precision === null) return true; // not checking precision if precision is not set
            const parts = val.split(".");
            if (parts.length === 1) {
                return true; // If no decimal part, it's valid
            }
            return parts[1].length <= precision; // Check decimal precision
        }, `Amount cannot have more than ${precision} decimal places`)
        .refine((val) => {
            if (balance === null) return true; // not checking balance if balance is not set
            const num = Number(val);
            return num <= balance; // Check if amount is less than balance
        }, `Insufficient balance`);
};
