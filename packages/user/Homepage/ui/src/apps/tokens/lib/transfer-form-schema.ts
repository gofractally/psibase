import z from "zod";

import { Account } from "@/lib/zod/Account";
import { TokenId } from "@/lib/zod/TokenId";

export const zTransferFormMemo = z.string().refine(
    (val) => {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(val);
        return bytes.length < 80;
    },
    {
        message: "Memo too long; must be less than 80 bytes",
    },
);

export const zTransferForm = (currentUser: string | null) =>
    z.object({
        token: TokenId,
        to: z.object({
            account: Account.refine((val) => val !== currentUser, {
                message: "Cannot send to yourself",
            }),
        }),
        amount: z.object({
            amount: z.string(),
        }),
        memo: zTransferFormMemo,
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
