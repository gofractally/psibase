import { z } from "zod";

import { Account } from "@/lib/zod/Account";
import { TokenId } from "@/lib/zod/TokenId";

export const createPrecisionSchema = (precision: number) => {
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

export const zTransferForm = z.object({
    token: TokenId,
    to: z.object({
        account: Account,
    }),
    amount: z.object({
        amount: z.string(),
    }),
    memo: z.string().max(50),
});

export const defaultTransferValues = {
    amount: {
        amount: "",
    },
    token: "",
    memo: "",
    to: {
        account: "",
    },
};
