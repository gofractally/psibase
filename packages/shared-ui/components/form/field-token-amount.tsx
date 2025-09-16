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
 *     disabled={isDisabled}
 * />
 * ```
 *
 * @param precision - The precision of the token
 * @param disabled - Whether the field is disabled
 * @returns A field for entering a token amount
 */
export const FieldTokenAmount = withFieldGroup({
    defaultValues: {
        amount: "",
    },
    props: {
        precision: undefined as number | undefined,
        disabled: false,
        description: undefined as string | undefined,
    },
    render: function Render({ group, precision, disabled, description }) {
        const p = (27.83658204756385).toFixed(precision ?? 0);
        return (
            <group.AppField
                name="amount"
                children={(field) => {
                    return (
                        <field.TextField
                            disabled={disabled || precision === undefined}
                            label="Amount"
                            placeholder={`e.g., ${p}`}
                            description={description}
                        />
                    );
                }}
                validators={{
                    onChange: zTokenAmount(precision ?? 0),
                }}
            />
        );
    },
});

const zTokenAmount = (precision: number) => {
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
            const parts = val.split(".");
            if (parts.length === 1) {
                return true; // If no decimal part, it's valid
            }
            return parts[1].length <= precision; // Check decimal precision
        }, `Amount cannot have more than ${precision} decimal places`);
};
