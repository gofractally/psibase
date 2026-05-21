import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";

export const defaultBuyFormValues = {
    accountName: "",
    maxCost: "",
};

export const zBuyForm = z.object({
    accountName: z
        .string()
        .trim()
        .pipe(zAccount),
    maxCost: z.string().trim().min(1, "Max cost is required"),
});

export type BuyFormValues = z.infer<typeof zBuyForm>;
