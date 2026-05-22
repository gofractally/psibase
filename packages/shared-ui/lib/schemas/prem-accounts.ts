import { z } from "zod";

import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
} from "@shared/lib/schemas/account";

export const zCurrentPriceRow = z.object({
    length: z
        .number()
        .int()
        .min(MIN_ACCOUNT_NAME_LENGTH)
        .max(MAX_ACCOUNT_NAME_LENGTH),
    price: z.string(),
});

export const zCurrentPricesData = z.object({
    currentPrices: z
        .array(zCurrentPriceRow)
        .nullable()
        .transform((rows) => rows ?? []),
});
