import { z } from "zod";

import { withFieldGroup } from "./app-form";

export const TokenAmountField = withFieldGroup({
    defaultValues: {
        amount: "",
    },
    props: {
        precision: undefined as number | undefined,
        disabled: false,
    },
    render: function Render({ group, precision, disabled }) {
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
