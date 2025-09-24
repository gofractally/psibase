import z from "zod";

import { Account } from "@/lib/zod/Account";
import { TokenId } from "@/lib/zod/TokenId";

export const zTransferForm = z.object({
    token: TokenId,
    to: z.object({
        account: Account,
    }),
    amount: z.object({
        amount: z.string(),
    }),
    memo: z.string().refine(
        (val) => {
            const encoder = new TextEncoder();
            const bytes = encoder.encode(val);
            return bytes.length < 80;
        },
        {
            message: "Memo must be less than 80 bytes",
        },
    ),
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
