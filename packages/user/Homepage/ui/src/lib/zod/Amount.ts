import { z } from "zod";

export const zAmount = z
    .string()
    .refine((amount) => amount.length > 0, {
        message: "Amount cannot be empty",
    })
    .refine(
        (amount) => {
            // Check if it's a valid number
            const num = Number(amount);
            return !Number.isNaN(num) && Number.isFinite(num);
        },
        {
            message: "Invalid number format",
        },
    )
    .refine(
        (amount) => {
            // Check if it's positive and greater than 0
            const num = Number(amount);
            return num > 0;
        },
        {
            message: "Amount must be greater than 0",
        },
    );

export const zAmountWithPrecision = (precision: number) =>
    z.string().refine(
        (amount) => {
            // Check decimal places don't exceed precision
            const parts = amount.split(".");
            if (parts.length === 1) {
                // No decimal part, so it's valid
                return true;
            }
            const decimalPart = parts[1];
            return decimalPart.length <= precision;
        },
        {
            message: `Amount cannot have more than ${precision} decimal places`,
        },
    );
