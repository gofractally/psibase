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
